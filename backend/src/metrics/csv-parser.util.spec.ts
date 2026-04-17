import { Readable } from 'node:stream';
import { parseRowsInBatches, ParsedRow } from './csv-parser.util';

async function collect(
  input: string | Buffer,
  batchSize = 1000,
): Promise<{ batches: ParsedRow[][]; flat: ParsedRow[] }> {
  const buffer = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
  const stream = Readable.from(buffer);
  const batches: ParsedRow[][] = [];
  const flat: ParsedRow[] = [];
  for await (const batch of parseRowsInBatches(stream, batchSize)) {
    batches.push([...batch]);
    flat.push(...batch);
  }
  return { batches, flat };
}

describe('parseRowsInBatches', () => {
  it('parses happy path header + rows into ParsedRow objects', async () => {
    const input =
      'metricId;dateTime;value\n' +
      '218219;21/11/2023 00:00;1\n' +
      '218219;21/11/2023 00:05;0\n';
    const { flat } = await collect(input);

    expect(flat).toEqual([
      { metricId: 218219, dateTime: '2023-11-21 00:00:00', value: 1 },
      { metricId: 218219, dateTime: '2023-11-21 00:05:00', value: 0 },
    ]);
  });

  it('strips UTF-8 BOM from the header', async () => {
    // BOM no inicio — foi o bug real que a gente pegou na Fase 3
    const input =
      '\uFEFFmetricId;dateTime;value\n' + '1;01/01/2024 12:00;5\n';
    const { flat } = await collect(input);

    expect(flat).toHaveLength(1);
    expect(flat[0].metricId).toBe(1);
    expect(flat[0].value).toBe(5);
  });

  it('accepts CRLF line endings (arquivos gerados no Windows/Excel)', async () => {
    const input =
      'metricId;dateTime;value\r\n' +
      '1;01/01/2024 12:00;5\r\n' +
      '2;02/01/2024 12:00;7\r\n';
    const { flat } = await collect(input);

    expect(flat.map((r) => r.metricId)).toEqual([1, 2]);
  });

  it('skips linhas ";;" vazias no final (padding do CSV fornecido)', async () => {
    const input =
      'metricId;dateTime;value\n' +
      '1;01/01/2024 12:00;5\n' +
      ';;\n' +
      ';;\n';
    const { flat } = await collect(input);

    expect(flat).toHaveLength(1);
  });

  it('throws com numero da linha quando metricId nao e numerico', async () => {
    const input =
      'metricId;dateTime;value\n' +
      '1;01/01/2024 12:00;5\n' +
      'abc;02/01/2024 12:00;7\n';

    await expect(collect(input)).rejects.toThrow(/linha 3/);
    await expect(collect(input)).rejects.toThrow(/metricId\/value invalidos/);
  });

  it('throws com numero da linha quando dateTime esta fora do formato DD/MM/YYYY HH:MM', async () => {
    const input =
      'metricId;dateTime;value\n' +
      '1;2024-01-01 12:00;5\n'; // formato ISO, nao DD/MM/YYYY

    await expect(collect(input)).rejects.toThrow(/linha 2/);
    await expect(collect(input)).rejects.toThrow(/dateTime invalido/);
  });

  it('emite multiplos batches quando N linhas > batchSize', async () => {
    const rows = Array.from(
      { length: 25 },
      (_, i) =>
        `${1000 + i};01/01/2024 ${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')};${i}`,
    );
    const input = ['metricId;dateTime;value', ...rows].join('\n');
    const { batches, flat } = await collect(input, 10);

    expect(flat).toHaveLength(25);
    expect(batches.map((b) => b.length)).toEqual([10, 10, 5]);
  });

  it('lida com input vazio (so header)', async () => {
    const { batches, flat } = await collect('metricId;dateTime;value\n');
    expect(batches).toHaveLength(0);
    expect(flat).toHaveLength(0);
  });

  it('preserva ordem das linhas dentro e entre batches', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => {
      const mm = String(i).padStart(2, '0');
      return `42;01/01/2024 00:${mm};${i}`;
    });
    const input = ['metricId;dateTime;value', ...rows].join('\n');
    const { flat } = await collect(input, 3);

    expect(flat.map((r) => r.value)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
