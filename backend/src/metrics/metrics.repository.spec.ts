import { DataSource } from 'typeorm';
import { Client } from 'pg';
import { MetricReading } from './entities/metric-reading.entity';
import { MetricsRepository } from './metrics.repository';
import { Granularity } from './dto/aggregate-query.dto';

const TEST_DB = 'gy_metrics_test';

const pgConfig = () => ({
  host: process.env.POSTGRES_HOST ?? 'postgres',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER ?? 'gy_user',
  password: process.env.POSTGRES_PASSWORD ?? 'gy_password',
});

async function ensureTestDb(): Promise<void> {
  const admin = new Client({ ...pgConfig(), database: 'postgres' });
  await admin.connect();
  const { rowCount } = await admin.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [TEST_DB],
  );
  if (rowCount === 0) {
    await admin.query(`CREATE DATABASE "${TEST_DB}"`);
  }
  await admin.end();
}

function createTestDataSource(): DataSource {
  const cfg = pgConfig();
  return new DataSource({
    type: 'postgres',
    host: cfg.host,
    port: cfg.port,
    username: cfg.user,
    password: cfg.password,
    database: TEST_DB,
    entities: [MetricReading],
    synchronize: true,
    dropSchema: true,
    logging: false,
  });
}

type Fixture = { metric_id: number; date_time: string; value: number };

async function seed(ds: DataSource, rows: Fixture[]): Promise<void> {
  for (const r of rows) {
    await ds.query(
      'INSERT INTO metric_readings (metric_id, date_time, value) VALUES ($1, $2, $3)',
      [r.metric_id, r.date_time, r.value],
    );
  }
}

describe('MetricsRepository (integracao real com Postgres)', () => {
  let ds: DataSource;
  let repo: MetricsRepository;

  beforeAll(async () => {
    await ensureTestDb();
    ds = createTestDataSource();
    await ds.initialize();
    repo = new MetricsRepository(ds);
  }, 30000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.destroy();
    }
  });

  beforeEach(async () => {
    await ds.query('TRUNCATE metric_readings RESTART IDENTITY');
  });

  describe('insertBatch', () => {
    it('insere em lote e retorna quantidade gravada', async () => {
      const inserted = await repo.insertBatch([
        { metricId: 1, dateTime: '2024-01-01 00:00:00', value: 1 },
        { metricId: 1, dateTime: '2024-01-01 00:05:00', value: 0 },
      ]);
      expect(inserted).toBe(2);
      expect(await repo.countAll()).toBe(2);
    });

    it('ON CONFLICT ignora duplicatas no mesmo (metric_id, date_time)', async () => {
      await repo.insertBatch([
        { metricId: 1, dateTime: '2024-01-01 00:00:00', value: 1 },
      ]);
      const inserted2 = await repo.insertBatch([
        { metricId: 1, dateTime: '2024-01-01 00:00:00', value: 99 },
        { metricId: 1, dateTime: '2024-01-01 00:05:00', value: 1 },
      ]);
      expect(inserted2).toBe(1); // so' a segunda linha entrou
      expect(await repo.countAll()).toBe(2);
    });

    it('retorna 0 para array vazio sem tocar o banco', async () => {
      const inserted = await repo.insertBatch([]);
      expect(inserted).toBe(0);
    });
  });

  describe('aggregate', () => {
    beforeEach(async () => {
      // Fixture: metric 100 com dados em 2 dias de novembro e 1 de dezembro, +
      // metric 999 no meio pra garantir isolamento por metric_id.
      await seed(ds, [
        { metric_id: 100, date_time: '2023-11-10 08:00:00', value: 5 },
        { metric_id: 100, date_time: '2023-11-10 20:00:00', value: 2 }, // dia 10 = 7
        { metric_id: 100, date_time: '2023-11-12 12:00:00', value: 3 }, // dia 12 = 3
        { metric_id: 100, date_time: '2023-12-01 10:00:00', value: 7 }, // dez = 7
        { metric_id: 999, date_time: '2023-11-11 12:00:00', value: 99 }, // nao pode vazar
      ]);
    });

    it('granularity DAY soma por dia, ordenado crescente', async () => {
      const rows = await repo.aggregate({
        metricId: 100,
        dateInitial: '2023-11-01',
        finalDate: '2023-12-31',
        granularity: Granularity.DAY,
      });
      expect(rows).toEqual([
        { date: '2023-11-10', value: 7 },
        { date: '2023-11-12', value: 3 },
        { date: '2023-12-01', value: 7 },
      ]);
    });

    it('granularity MONTH soma todo o mes e devolve o primeiro dia', async () => {
      const rows = await repo.aggregate({
        metricId: 100,
        dateInitial: '2023-11-01',
        finalDate: '2023-12-31',
        granularity: Granularity.MONTH,
      });
      expect(rows).toEqual([
        { date: '2023-11-01', value: 10 }, // 5+2+3
        { date: '2023-12-01', value: 7 },
      ]);
    });

    it('granularity YEAR soma o ano inteiro', async () => {
      const rows = await repo.aggregate({
        metricId: 100,
        dateInitial: '2023-01-01',
        finalDate: '2023-12-31',
        granularity: Granularity.YEAR,
      });
      expect(rows).toEqual([{ date: '2023-01-01', value: 17 }]);
    });

    it('isola por metric_id: metric 999 nao vaza no resultado de 100', async () => {
      const rows = await repo.aggregate({
        metricId: 100,
        dateInitial: '2023-11-01',
        finalDate: '2023-11-30',
        granularity: Granularity.DAY,
      });
      const sum = rows.reduce((acc, r) => acc + r.value, 0);
      expect(sum).toBe(10); // sem os 99 do metric 999
    });

    it('retorna [] quando nao ha dados no intervalo', async () => {
      const rows = await repo.aggregate({
        metricId: 100,
        dateInitial: '2020-01-01',
        finalDate: '2020-12-31',
        granularity: Granularity.DAY,
      });
      expect(rows).toEqual([]);
    });

    it('range e inclusivo nos dois extremos (dia inteiro no finalDate)', async () => {
      await ds.query('TRUNCATE metric_readings RESTART IDENTITY');
      await seed(ds, [
        { metric_id: 1, date_time: '2024-01-01 00:00:00', value: 1 },
        { metric_id: 1, date_time: '2024-01-02 23:59:00', value: 1 },
        { metric_id: 1, date_time: '2024-01-03 00:00:00', value: 1 },
      ]);
      const rows = await repo.aggregate({
        metricId: 1,
        dateInitial: '2024-01-01',
        finalDate: '2024-01-02',
        granularity: Granularity.DAY,
      });
      expect(rows.map((r) => r.date)).toEqual(['2024-01-01', '2024-01-02']);
      // 2024-01-03 fica fora do range
    });
  });

  describe('report', () => {
    it('formata DateTime como DD/MM/YYYY e monta colunas aggDay/Month/Year', async () => {
      await seed(ds, [
        { metric_id: 100, date_time: '2023-11-10 08:00:00', value: 5 },
        { metric_id: 100, date_time: '2023-11-12 12:00:00', value: 3 },
        { metric_id: 100, date_time: '2023-12-01 10:00:00', value: 7 },
      ]);
      const rows = await repo.report({
        metricId: 100,
        dateInitial: '2023-11-01',
        finalDate: '2023-12-31',
      });
      expect(rows).toEqual([
        { metricId: 100, dateTime: '10/11/2023', aggDay: 5, aggMonth: 8, aggYear: 15 },
        { metricId: 100, dateTime: '12/11/2023', aggDay: 3, aggMonth: 8, aggYear: 15 },
        { metricId: 100, dateTime: '01/12/2023', aggDay: 7, aggMonth: 7, aggYear: 15 },
      ]);
    });

    it('multi-mes: aggMonth distingue meses, aggYear agrega todos', async () => {
      await seed(ds, [
        { metric_id: 1, date_time: '2023-10-15 12:00:00', value: 5 },
        { metric_id: 1, date_time: '2023-10-16 12:00:00', value: 3 },
        { metric_id: 1, date_time: '2023-11-10 08:00:00', value: 7 },
        { metric_id: 1, date_time: '2023-11-12 08:00:00', value: 2 },
      ]);
      const rows = await repo.report({
        metricId: 1,
        dateInitial: '2023-10-01',
        finalDate: '2023-11-30',
      });
      expect(rows).toEqual([
        { metricId: 1, dateTime: '15/10/2023', aggDay: 5, aggMonth: 8, aggYear: 17 },
        { metricId: 1, dateTime: '16/10/2023', aggDay: 3, aggMonth: 8, aggYear: 17 },
        { metricId: 1, dateTime: '10/11/2023', aggDay: 7, aggMonth: 9, aggYear: 17 },
        { metricId: 1, dateTime: '12/11/2023', aggDay: 2, aggMonth: 9, aggYear: 17 },
      ]);
    });

    it('range-bound: aggYear conta apenas dias dentro do range requisitado', async () => {
      // Esta e' a decisao documentada na Fase 5 — se um dia do ano esta' fora
      // do range pedido, ele nao deve aparecer em aggYear.
      await seed(ds, [
        { metric_id: 1, date_time: '2023-10-15 12:00:00', value: 50 }, // FORA do range
        { metric_id: 1, date_time: '2023-11-10 08:00:00', value: 7 },
        { metric_id: 1, date_time: '2023-11-12 08:00:00', value: 2 },
      ]);
      const rows = await repo.report({
        metricId: 1,
        dateInitial: '2023-11-01',
        finalDate: '2023-11-30',
      });
      // aggYear = 9 (7+2), NAO 59 (nao inclui o dia 15/10 que esta fora do range)
      expect(rows.map((r) => r.aggYear)).toEqual([9, 9]);
    });

    it('retorna array vazio quando nao ha leituras no range', async () => {
      const rows = await repo.report({
        metricId: 999,
        dateInitial: '2020-01-01',
        finalDate: '2020-12-31',
      });
      expect(rows).toEqual([]);
    });
  });
});
