import { parse } from 'csv-parse';
import type { Readable } from 'node:stream';

export type ParsedRow = {
  metricId: number;
  dateTime: string;
  value: number;
};

type RawCsvRow = { metricId: string; dateTime: string; value: string };

/**
 * Async generator que produz lotes de linhas parseadas.
 * Consome o stream do CSV por eventos, acumula `batchSize` rows e emite.
 * Uso:
 *   for await (const batch of parseRowsInBatches(stream, 1000)) {
 *     await repo.insertBatch(batch);
 *   }
 * Memoria: O(batchSize), independente do tamanho do arquivo.
 */
export async function* parseRowsInBatches(
  source: Readable | NodeJS.ReadableStream,
  batchSize: number,
): AsyncGenerator<ParsedRow[], void, void> {
  const parser = parse({
    delimiter: ';',
    columns: true,
    skip_empty_lines: true,
    skip_records_with_empty_values: true,
    trim: true,
    bom: true,
  });

  source.pipe(parser);

  let batch: ParsedRow[] = [];
  let lineNumber = 1; // linha 1 = header

  for await (const raw of parser) {
    lineNumber += 1;
    batch.push(parseRow(raw as RawCsvRow, lineNumber));
    if (batch.length >= batchSize) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length > 0) {
    yield batch;
  }
}

function parseRow(r: RawCsvRow, lineNumber: number): ParsedRow {
  const metricId = Number(r.metricId);
  const value = Number(r.value);
  if (!Number.isFinite(metricId) || !Number.isFinite(value)) {
    throw new Error(
      `linha ${lineNumber}: metricId/value invalidos (${r.metricId}, ${r.value})`,
    );
  }
  return {
    metricId,
    dateTime: toPgTimestamp(r.dateTime, lineNumber),
    value,
  };
}

function toPgTimestamp(raw: string, lineNumber: number): string {
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error(`linha ${lineNumber}: dateTime invalido: "${raw}"`);
  }
  const [, day, month, year, hour, minute] = match;
  return `${year}-${month}-${day} ${hour}:${minute}:00`;
}
