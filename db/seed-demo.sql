-- Seed de dados sinteticos pro metricId 999.
-- Gera 60 dias de leituras (1 por hora) pra demonstrar
-- cenarios com paginacao ativa na UI.
--
-- Idempotente: o UNIQUE (metric_id, date_time) + ON CONFLICT DO NOTHING
-- garantem que rodar multiplas vezes nao duplica.
--
-- Uso:
--   docker exec -i gy-postgres \
--     psql -U gy_user -d gy_metrics < db/seed-demo.sql

INSERT INTO metric_readings (metric_id, date_time, value)
SELECT
  999,
  '2024-01-01'::timestamp
    + (n || ' days')::interval
    + (INTERVAL '1 hour' * h),
  (random() * 50)::int + 1
FROM
  generate_series(0, 59) AS n,
  generate_series(0, 23) AS h
ON CONFLICT (metric_id, date_time) DO NOTHING;
