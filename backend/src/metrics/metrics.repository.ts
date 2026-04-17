import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { ParsedRow } from './csv-parser.util';
import { Granularity } from './dto/aggregate-query.dto';

const GRANULARITY_TO_PG: Record<Granularity, string> = {
  [Granularity.DAY]: 'day',
  [Granularity.MONTH]: 'month',
  [Granularity.YEAR]: 'year',
};

export type AggregatedPoint = {
  date: string;
  value: number;
};

export type ReportRow = {
  metricId: number;
  dateTime: string;
  aggDay: number;
  aggMonth: number;
  aggYear: number;
};

@Injectable()
export class MetricsRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Insere UM lote de leituras atomicamente.
   * ON CONFLICT DO NOTHING torna a operacao idempotente — se o consumer
   * reprocessa um blob (ex.: nack+requeue, reupload), duplicatas sao ignoradas.
   * Retorna quantas linhas foram efetivamente inseridas.
   */
  async insertBatch(rows: ParsedRow[]): Promise<number> {
    if (rows.length === 0) return 0;

    const placeholders: string[] = [];
    const params: unknown[] = [];
    rows.forEach((row, idx) => {
      const offset = idx * 3;
      placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3})`);
      params.push(row.metricId, row.dateTime, row.value);
    });

    const sql = `
      INSERT INTO metric_readings (metric_id, date_time, value)
      VALUES ${placeholders.join(',')}
      ON CONFLICT (metric_id, date_time) DO NOTHING
      RETURNING id
    `;

    const result = (await this.dataSource.query(sql, params)) as unknown[];
    return result.length;
  }

  async countAll(): Promise<number> {
    const rows = (await this.dataSource.query(
      'SELECT COUNT(*)::int AS count FROM metric_readings',
    )) as { count: number }[];
    return rows[0]?.count ?? 0;
  }

  async aggregate(params: {
    metricId: number;
    dateInitial: string;
    finalDate: string;
    granularity: Granularity;
  }): Promise<AggregatedPoint[]> {
    const trunc = GRANULARITY_TO_PG[params.granularity];
    const sql = `
      SELECT
        to_char(date_trunc($1, date_time), 'YYYY-MM-DD') AS date,
        SUM(value)::int AS value
      FROM metric_readings
      WHERE metric_id = $2
        AND date_time >= $3::date
        AND date_time <  ($4::date + INTERVAL '1 day')
      GROUP BY 1
      ORDER BY 1
    `;
    return this.dataSource.query(sql, [
      trunc,
      params.metricId,
      params.dateInitial,
      params.finalDate,
    ]);
  }

  async report(params: {
    metricId: number;
    dateInitial: string;
    finalDate: string;
  }): Promise<ReportRow[]> {
    const sql = `
      WITH daily AS (
        SELECT
          metric_id,
          date_trunc('day', date_time)::date   AS day,
          date_trunc('month', date_time)       AS month_trunc,
          date_trunc('year', date_time)        AS year_trunc,
          SUM(value)                           AS day_sum
        FROM metric_readings
        WHERE metric_id = $1
          AND date_time >= $2::date
          AND date_time <  ($3::date + INTERVAL '1 day')
        GROUP BY metric_id,
                 date_trunc('day', date_time),
                 date_trunc('month', date_time),
                 date_trunc('year', date_time)
      )
      SELECT
        metric_id                                                  AS "metricId",
        to_char(day, 'DD/MM/YYYY')                                 AS "dateTime",
        day_sum::int                                               AS "aggDay",
        (SUM(day_sum) OVER (PARTITION BY month_trunc))::int        AS "aggMonth",
        (SUM(day_sum) OVER (PARTITION BY year_trunc))::int         AS "aggYear"
      FROM daily
      ORDER BY day
    `;
    return this.dataSource.query(sql, [
      params.metricId,
      params.dateInitial,
      params.finalDate,
    ]);
  }
}
