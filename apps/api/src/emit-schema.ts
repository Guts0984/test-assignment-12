import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { GraphQLSchemaBuilderModule, GraphQLSchemaFactory } from '@nestjs/graphql';
import { lexicographicSortSchema, printSchema } from 'graphql';
import { RESOLVERS } from './module.js';

// Builds the schema from the code-first classes (no database or Redis needed) and writes
// schema.gql: the single source for the web app's GraphQL Codegen.
const app = await NestFactory.create(GraphQLSchemaBuilderModule, { logger: false });
await app.init();
const schema = await app.get(GraphQLSchemaFactory).create(RESOLVERS as never);
writeFileSync(new URL('../schema.gql', import.meta.url), printSchema(lexicographicSortSchema(schema)) + '\n');
await app.close();
console.log('schema.gql written');
