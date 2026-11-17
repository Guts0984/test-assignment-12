import { from as copyFrom } from 'pg-copy-streams';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import type pg from 'pg';

export type CellValue = string | number | boolean | Date | null;

const cell = (v: CellValue): string => {
  if (v === null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? 't' : 'f';
  if (typeof v === 'number') return String(v);
  return `"${v.replace(/"/g, '""')}"`;
};

/** Streams rows into a table with COPY ... FROM STDIN (CSV). Empty unquoted cell = NULL. */
export const copyRows = async (
  client: pg.PoolClient,
  table: string,
  columns: readonly string[],
  rows: Iterable<readonly CellValue[]>,
): Promise<void> => {
  const stream = client.query(
    copyFrom(`COPY ${table} (${columns.join(', ')}) FROM STDIN WITH (FORMAT csv)`),
  );
  async function* lines(): AsyncGenerator<string> {
    let buf: string[] = [];
    for (const row of rows) {
      buf.push(row.map(cell).join(',') + '\n');
      if (buf.length >= 2000) {
        yield buf.join('');
        buf = [];
      }
    }
    if (buf.length) yield buf.join('');
  }
  await pipeline(Readable.from(lines()), stream);
};
