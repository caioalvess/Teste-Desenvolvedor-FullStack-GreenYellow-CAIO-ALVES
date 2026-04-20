-- Seed de dados sinteticos pro metricId 999.
-- Gera 60 dias de leituras (1 por hora) pra demonstrar
-- cenarios com paginacao ativa na UI.
--
-- Idempotencia: como o unique da tabela e' (metric_id, date_time,
-- csv_upload_id) e as linhas do seed tem csv_upload_id = NULL (nao
-- vem de upload real), um ON CONFLICT sobre (metric_id, date_time)
-- sozinho nao bate com nenhuma constraint. NULLs tambem nao se
-- comparam entre si em unique indexes — cada re-execucao duplicaria.
-- Solucao: DELETE explicito das linhas "demo" antes do INSERT. A
-- operacao e' atomica dentro de uma transacao implicita do psql quando
-- rodada via `-f seed.sql`.
--
-- Uso:
--   docker exec -i gy-postgres \
--     psql -U gy_user -d gy_metrics < db/seed-demo.sql

BEGIN;

DELETE FROM metric_readings
WHERE metric_id = 999 AND csv_upload_id IS NULL;

INSERT INTO metric_readings (metric_id, date_time, value)
SELECT
  999,
  '2024-01-01'::timestamp
    + (n || ' days')::interval
    + (INTERVAL '1 hour' * h),
  (random() * 50)::int + 1
FROM
  generate_series(0, 59) AS n,
  generate_series(0, 23) AS h;

COMMIT;
