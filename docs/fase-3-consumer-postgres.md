# Fase 3 — Consumer + Parser + Postgres

**Objetivo:** consumir mensagens da fila `csv.uploaded`, baixar o blob do Azurite, parsear o CSV e persistir no Postgres em batch. Atende itens 3, 4, 5 e 6 do enunciado.

---

## 1. Modelo de dados

Uma tabela crua `metric_readings`:

```sql
CREATE TABLE metric_readings (
  id        BIGSERIAL PRIMARY KEY,
  metric_id INTEGER   NOT NULL,
  date_time TIMESTAMP NOT NULL,
  value     INTEGER   NOT NULL,
  CONSTRAINT uq_metric_readings_metric_datetime
    UNIQUE (metric_id, date_time)
);

CREATE INDEX idx_metric_readings_metric_datetime
  ON metric_readings (metric_id, date_time);
```

### Por que tabela crua, não pré-agregada
O enunciado não fala em pré-agregação, e o endpoint de agregação (item 7) precisa de flexibilidade: qualquer intervalo, qualquer granularidade (DAY/MONTH/YEAR). Agregar em query com `date_trunc()` aproveita o índice composto `(metric_id, date_time)` — é O(linhas do range), não O(total).

Se o volume crescesse (centenas de milhões de linhas), aí sim valeria pensar em tabelas materializadas ou particionamento por mês. Pra este teste, crua é o certo.

### Por que `UNIQUE (metric_id, date_time)`
- **Idempotência**: se o mesmo blob for processado duas vezes (ex.: consumer caiu após gravar e antes de ack), `ON CONFLICT DO NOTHING` impede duplicata.
- **Semântica**: não faz sentido existir duas leituras diferentes para a mesma métrica no mesmo instante.
- **Performance do INSERT**: a unique constraint já cria um índice btree que também serve de lookup — por isso o `idx_` separado é tecnicamente redundante com a unique, mas deixo explícito pra clareza. PostgreSQL reaproveita o btree da unique.

### Por que `timestamp without time zone`
O CSV não carrega offset/timezone. Tratar como "naive timestamp" evita conversão implícita que poderia deslocar horários se a TZ do cliente fosse diferente da do servidor. O driver pg recebe string `'YYYY-MM-DD HH:MM:00'` e grava literal.

---

## 2. Arquivos criados / alterados

```
backend/src/
├── app.module.ts                          # + DatabaseModule, ConsumerModule
├── database/
│   └── database.module.ts                 # TypeOrmModule.forRootAsync
├── metrics/
│   ├── metrics.module.ts
│   ├── metrics.repository.ts              # SQL puro, insert em batch transacional
│   ├── csv-parser.util.ts                 # csv-parse + validacao + formato PG
│   └── entities/metric-reading.entity.ts  # @Entity/@Unique/@Index
├── consumer/
│   ├── consumer.module.ts
│   └── csv-consumer.service.ts            # orquestra download -> parse -> persist
└── rabbitmq/rabbitmq.service.ts           # + metodo consume() com ack/nack
```

## 3. Decisões de arquitetura

### TypeORM com `synchronize: true` em dev
A entidade é a fonte da verdade do schema. `synchronize: true` cria/atualiza a tabela na subida, sem migration. Escolhas possíveis:

| Opção | Prós | Contras |
|-------|------|---------|
| `synchronize: true` ✅ escolhido | zero boilerplate, fase 3 roda de cara | perigoso em prod — pode dropar colunas |
| Migrations TypeORM | schema versionado, seguro pra prod | precisa de boilerplate (DataSource config, script de run, nest-cli integration) |

**Decisão:** `synchronize: true` + comentário no código + seção de "Melhorias" no README propondo migrations pra prod. Pragma de dev, explícito no review.

### SQL puro com `ON CONFLICT DO NOTHING RETURNING id`
O enunciado pede preferência por SQL puro (item 5). O repo usa `dataSource.query(sql, params)`. Pontos:

- **`ON CONFLICT DO NOTHING`**: idempotência barata. Custo: ainda faz lookup no índice antes de desistir, mas é sub-milissegundo.
- **`RETURNING id`**: permite saber quantas linhas **efetivamente** entraram (pra log: `Persisted X/Y`). Sem isso, `INSERT` retorna array vazio e a gente só sabe o total tentado.
- **Placeholders `$1, $2, ...`**: prevenção de SQL injection. Nunca concatena valor — só monta a string dos placeholders.

### Batch de 1000 linhas em transação
93k linhas como um único `INSERT VALUES (...), (...), ...` gera uma query com ~280k parâmetros — Postgres aceita até ~65k por query. Precisa chunking.

Tamanhos testados mentalmente:
- 100 linhas/batch: 930 queries → muito overhead de round-trip
- 1000 linhas/batch: 93 queries → **escolhido**
- 10k linhas/batch: risco de bater limite de parâmetros ou bufferar mais memória

A transação externa garante atomicidade: ou grava tudo, ou nada. Se cair na batch 50, o `ROLLBACK` automático desfaz as anteriores, o consumer nack-a, o reviewer vê a falha clara.

Resultado medido: **93088 linhas em 3671ms** ≈ 25k linhas/segundo.

### `ack` só depois do commit, `nack(requeue=false)` em erro
```
consume(msg) {
  try {
    handler(msg)  // download + parse + insertReadings (transacional)
    ack(msg)      // so' se tudo deu certo
  } catch (e) {
    nack(msg, false, false)  // nao requeue
  }
}
```

**Por que não requeue:** se der erro, requeue causaria loop infinito (erro geralmente é determinístico — CSV malformado, blob inexistente). Sem DLQ ainda, o erro fica só no log. Trade-off anotado pra Fase 7.

### CSV parsing com `csv-parse/sync` + flags
O arquivo tinha **3 armadilhas** que custaram 2 tentativas:

1. **UTF-8 BOM** no início → `metricId` virava `\ufeffmetricId`, `r.metricId` undefined. Fix: `bom: true`.
2. **CRLF** (terminadores do Windows) → csv-parse já lida com default.
3. **Linhas `;;` no final** do arquivo (padding do Excel) → geraria rows com campos vazios. Fix: `skip_records_with_empty_values: true`.

Validação por linha (regex de data + `Number.isFinite`) detecta problemas cedo e com contexto claro: `linha 93090: dateTime invalido: ""`.

### Conversão de data em texto, não `Date`
```typescript
// entrada:  "21/11/2023 00:00"
// saida:    "2023-11-21 00:00:00"
```

Isso evita o ciclo string → Date → string com risco de deslocamento por fuso horário. O Postgres recebe a string e grava no `timestamp without time zone` exatamente como chega.

### `@Global()` NÃO usado no MetricsModule
Diferente de `AzuriteModule` e `RabbitMqModule`, o `MetricsModule` é importado explicitamente pelo `ConsumerModule`. Motivos:
- MetricsRepository é um provider de domínio, não de infra.
- Import explícito deixa a dependência óbvia ao ler `consumer.module.ts`.
- `@Global()` é "magia conveniente" — bom pra infra reutilizável, ruim pra domínio.

---

## 4. Fluxo end-to-end

```
cliente               API                 Azurite            RabbitMQ            Consumer           Postgres
  │                    │                     │                  │                    │                  │
  │─ POST /uploads ───>│                     │                  │                    │                  │
  │                    │─ uploadBlob ──────> │                  │                    │                  │
  │                    │─ publish(msg) ──────────────────────── > assertQueue        │                  │
  │<── 201 ────────────│                                          │  (fila durable)   │                  │
  │                                                               │─ channel.consume >│                  │
  │                                                               │                   │─ downloadBlob ──>│
  │                                                               │                   │<── Buffer ───────│ Azurite
  │                                                               │                   │ parseCsvBuffer    │
  │                                                               │                   │                  │
  │                                                               │                   │─ insertReadings ─>│
  │                                                               │                   │  BEGIN            │
  │                                                               │                   │  INSERT x93       │
  │                                                               │                   │  COMMIT           │
  │                                                               │<─── channel.ack ──│                  │
```

## 5. Verificação executada (2026-04-16)

| # | Teste | Resultado |
|---|-------|-----------|
| A | Tabela criada com colunas, índice e unique na subida | ✓ |
| B | Consumer inicia e loga `Consumer started on queue 'csv.uploaded'` | ✓ |
| C | Upload CSV → consumer loga `Parsed 93088 rows` | ✓ (após fixes de BOM + skip empty) |
| D | `Persisted 93088/93088 rows (3671ms)` | ✓ |
| E | `SELECT COUNT(*)` = 93088 | ✓ |
| F | 256 métricas distintas, range correto (21/11/2023 00:00 → 22/11/2023 08:50) | ✓ |
| G | Amostra de `metric_id=218219` bate com as primeiras linhas do CSV | ✓ |
| H | Segundo upload do mesmo arquivo → `Persisted 0/93088` (conflitos ignorados) | ✓ idempotente |
| I | `GET /health` segue 200 | ✓ |

## 6. Performance observada

- **Upload (HTTP)**: ~200ms pro arquivo de 2.4MB (memória → Azurite)
- **Download (Azurite → API)**: ~100ms
- **Parse CSV (93k linhas)**: ~600ms
- **Insert em batch (93 batches × 1000 linhas)**: ~3s
- **Total end-to-end**: ~4s do upload até o último row commitado

## 7. Comandos úteis

```bash
# ver o schema
docker exec gy-postgres psql -U gy_user -d gy_metrics -c "\d metric_readings"

# contar linhas
docker exec gy-postgres psql -U gy_user -d gy_metrics -c "SELECT COUNT(*) FROM metric_readings"

# resetar dados pra re-testar
docker exec gy-postgres psql -U gy_user -d gy_metrics -c "TRUNCATE metric_readings"

# acompanhar consumer em tempo real
docker compose logs -f api
```

## 8. Pendências anotadas para próximas fases

- **Fase 4 (agregação)**: query com `date_trunc('day'|'month'|'year', date_time)` + `SUM(value)` filtrando por `metric_id` e range. Usa o índice composto.
- **Fase 4**: pensar em `generate_series` pra preencher dias sem dados com zero (depende do que o teste espera).
- **Melhorias (pra README final)**:
  - Migrations TypeORM ao invés de `synchronize`
  - DLQ + retry com backoff no consumer
  - Streaming parse pra arquivos >50MB (usar `csv-parse` stream API + `pg-copy-streams`)
  - Deduplicar logic no produtor (se upload do mesmo arquivo em 2s → skip)

---

**Status:** ✅ concluída e validada em 2026-04-16.
