import { GraphQLError, Kind, type DocumentNode, type FragmentDefinitionNode, type GraphQLSchema, type OperationDefinitionNode, type SelectionSetNode, type ValueNode } from 'graphql';
import type { ApolloServerPlugin } from '@apollo/server';
import { gqlError } from './errors.js';

export type Limits = { maxDepth: number; maxComplexity: number; maxFields: number };

type Frags = Map<string, FragmentDefinitionNode>;

const walk = (set: SelectionSetNode, frags: Frags, depth: number, seen: Set<string>, acc: { depth: number; fields: number }): void => {
  for (const sel of set.selections) {
    if (sel.kind === Kind.FIELD) {
      acc.fields++;
      const d = depth + 1;
      if (d > acc.depth) acc.depth = d;
      if (sel.selectionSet) walk(sel.selectionSet, frags, d, seen, acc);
    } else if (sel.kind === Kind.INLINE_FRAGMENT) {
      walk(sel.selectionSet, frags, depth, seen, acc);
    } else {
      const f = frags.get(sel.name.value);
      // a fragment that spreads itself is already rejected by validation; stay safe anyway
      if (f && !seen.has(f.name.value)) walk(f.selectionSet, frags, depth, new Set([...seen, f.name.value]), acc);
    }
  }
};

export const measure = (doc: DocumentNode, operationName?: string | null): { depth: number; fields: number } => {
  const frags: Frags = new Map();
  const ops: OperationDefinitionNode[] = [];
  for (const d of doc.definitions) {
    if (d.kind === Kind.FRAGMENT_DEFINITION) frags.set(d.name.value, d);
    else if (d.kind === Kind.OPERATION_DEFINITION) ops.push(d);
  }
  const op = (operationName ? ops.find((o) => o.name?.value === operationName) : ops[0]) ?? ops[0];
  const acc = { depth: 0, fields: 0 };
  if (op) walk(op.selectionSet, frags, 0, new Set(), acc);
  return acc;
};

const intArg = (node: ValueNode | undefined, variables: Record<string, unknown>): number | null => {
  if (!node) return null;
  if (node.kind === Kind.INT) return Number(node.value);
  if (node.kind === Kind.VARIABLE) {
    const v = variables[node.name.value];
    return typeof v === 'number' ? v : null;
  }
  return null;
};

/**
 * Estimated cost: every field costs 1; a list multiplies the cost of what is selected inside it by
 * its `limit` argument (10 when absent, at most 1000). So "100 visits, each with doctor, clinic,
 * service, patient and history" is priced as the hundreds of rows it really is.
 * Own implementation on purpose: the ready-made library loads a second copy of `graphql` and
 * cannot read this schema.
 */
// Type inspection by shape, not `instanceof`: under some loaders (tests) the schema and this file see
// two copies of the graphql package, and its own helpers refuse to mix them.
type AnyType = { toString(): string; getFields?: () => Record<string, { type: AnyType }> };
const isList = (t: AnyType): boolean => /^\[/.test(String(t).replace(/!$/, ''));
const namedOf = (t: AnyType): string => String(t).replace(/[[\]!]/g, '');

export const estimateCost = (schema: GraphQLSchema, doc: DocumentNode, variables: Record<string, unknown>, operationName?: string | null): number => {
  const frags: Frags = new Map();
  const ops: OperationDefinitionNode[] = [];
  for (const d of doc.definitions) {
    if (d.kind === Kind.FRAGMENT_DEFINITION) frags.set(d.name.value, d);
    else if (d.kind === Kind.OPERATION_DEFINITION) ops.push(d);
  }
  const op = (operationName ? ops.find((o) => o.name?.value === operationName) : ops[0]) ?? ops[0];
  if (!op) return 0;
  const root = (op.operation === 'mutation' ? schema.getMutationType() : op.operation === 'subscription' ? schema.getSubscriptionType() : schema.getQueryType()) as AnyType | null | undefined;
  if (!root) return 0;
  const typeByName = (name: string): AnyType | undefined => schema.getType(name) as AnyType | undefined;
  const cost = (set: SelectionSetNode, parent: AnyType, depth: number): number => {
    if (depth > 60) return 1_000_000;
    let total = 0;
    for (const sel of set.selections) {
      if (sel.kind === Kind.FIELD) {
        const name = sel.name.value;
        if (name.startsWith('__')) { total += 1; continue; }
        const def = parent.getFields?.()[name];
        if (!def) { total += 1; continue; }
        const named = typeByName(namedOf(def.type));
        const inner = sel.selectionSet && named?.getFields ? cost(sel.selectionSet, named, depth + 1) : 0;
        const list = isList(def.type);
        const limit = intArg(sel.arguments?.find((a) => a.name.value === 'limit')?.value, variables);
        const mult = list ? Math.min(limit ?? 10, 1000) : 1;
        total += 1 + inner * mult;
      } else if (sel.kind === Kind.INLINE_FRAGMENT) {
        const t = sel.typeCondition ? typeByName(sel.typeCondition.name.value) : parent;
        total += cost(sel.selectionSet, t?.getFields ? t : parent, depth + 1);
      } else {
        const f = frags.get(sel.name.value);
        const t = f ? typeByName(f.typeCondition.name.value) : undefined;
        if (f && t?.getFields) total += cost(f.selectionSet, t, depth + 1);
      }
    }
    return total;
  };
  return cost(op.selectionSet, root, 0);
};

/**
 * Depth, total field count (this also bounds alias bombs: 10 000 aliases are 10 000 fields) and
 * estimated cost are checked BEFORE execution. Used for HTTP (Apollo plugin) and for subscriptions
 * (graphql-ws does not go through Apollo plugins).
 */
export const checkLimits = (schema: GraphQLSchema, doc: DocumentNode, variables: Record<string, unknown> | undefined, operationName: string | null | undefined, limits: Limits): GraphQLError | null => {
  const m = measure(doc, operationName);
  if (m.depth > limits.maxDepth) return gqlError('QUERY_TOO_COMPLEX', `Query is too deep (${m.depth} > ${limits.maxDepth})`);
  if (m.fields > limits.maxFields) return gqlError('QUERY_TOO_COMPLEX', `Query selects too many fields (${m.fields} > ${limits.maxFields})`);
  const cost = estimateCost(schema, doc, variables ?? {}, operationName);
  if (cost > limits.maxComplexity) return gqlError('QUERY_TOO_COMPLEX', `Query is too expensive (${cost} > ${limits.maxComplexity})`);
  return null;
};

export const limitsPlugin = (getSchema: () => GraphQLSchema | null, limits: Limits): ApolloServerPlugin => ({
  requestDidStart: async () => ({
    didResolveOperation: async ({ document, request }) => {
      const schema = getSchema();
      if (!schema) return;
      const e = checkLimits(schema, document, request.variables, request.operationName, limits);
      if (e) throw e;
    },
  }),
});
