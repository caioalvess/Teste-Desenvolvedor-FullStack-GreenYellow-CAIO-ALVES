# Fase 4 — Endpoint de Agregação

**Objetivo:** endpoint que recebe `{metricId, dateInitial, finalDate}` + granularidade e devolve a série agregada. Atende item 7 do enunciado.

---

## 1. Contrato

### Request

```
GET /metrics/aggregate?metricId=71590&dateInitial=2023-11-01&finalDate=2023-12-31&granularity=DAY
```

| Param | Tipo | Obrigatório | Default | Observação |
|-------|------|------------|---------|------------|
| `metricId` | int | sim | — | ≥ 0 |
| `dateInitial` | string | sim | — | `YYYY-MM-DD` (ISO) |
| `finalDate` | string | sim | — | `YYYY-MM-DD` (ISO) — **inclusivo** |
| `granularity` | enum | não | `DAY` | `DAY` \| `MONTH` \| `YEAR` |

### Response (200)

```json
[
  { "date": "2023-11-21", "value": 266 },
  { "date": "2023-11-22", "value": 96 }
]
```

- Datas sempre em `YYYY-MM-DD`. Para MONTH/YEAR, volta o primeiro dia do período (`2023-11-01` pra novembro, `2023-01-01` pra 2023).
- `value` é `SUM(value)` das leituras dentro do bucket.
- Dias sem leitura **não** aparecem (não preenche com zero — mais simples; pode virar melhoria).

### Erros (400)

```json
{ "message": ["dateInitial deve estar em YYYY-MM-DD"], "error": "Bad Request", "statusCode": 400 }
```

---

## 2. Arquivos criados / alterados

```
backend/src/
├── main.ts                                # + ValidationPipe global
├── app.module.ts                          # + MetricsModule importado
├── metrics/
│   ├── metrics.module.ts                  # + MetricsController
│   ├── metrics.controller.ts              # GET /metrics/aggregate
│   ├── metrics.repository.ts              # + metodo aggregate()
│   └── dto/aggregate-query.dto.ts         # validacao class-validator
backend/package.json                       # + class-validator, class-transformer
```

## 3. Decisões

### GET com query params, não POST
O enunciado mostra a entrada como JSON, mas a operação é uma **leitura idempotente sem side effects** — GET é semanticamente correto. Vantagens:
- Cacheável (CDN, browser, reverse proxy).
- URL compartilhável/bookmarkável.
- Curl mais direto.
- Testável no browser sem ferramenta extra.

Fica claro que o JSON no enunciado é "forma dos campos", não "tem que ser POST body". Se for requisito duro, o DTO é o mesmo — basta trocar `@Query()` por `@Body()` e anotar `@Post('aggregate')`.

### Granularity como query param opcional, default DAY
O enunciado diz "Os tipos de agregações podem ser DAY, MONTH e YEAR" como OBS, separado da definição do input. Interpretei como "é um parâmetro da chamada" (não três endpoints diferentes). Default DAY porque é o caso mais granular e condiz com o exemplo do enunciado.

### SQL puro com `date_trunc` + `to_char`

```sql
SELECT
  to_char(date_trunc($1, date_time), 'YYYY-MM-DD') AS date,
  SUM(value)::int AS value
FROM metric_readings
WHERE metric_id = $2
  AND date_time >= $3::date
  AND date_time <  ($4::date + INTERVAL '1 day')
GROUP BY 1
ORDER BY 1
```

Pontos do SQL:
- **`date_trunc($1, date_time)`**: primeiro argumento aceita `'day'`/`'month'`/`'year'` — mapeio da enum em TypeScript (whitelist) e passo como parâmetro. Zero SQL injection.
- **`to_char(..., 'YYYY-MM-DD')`**: devolve **string** de data ao invés de `Date`. Sem isso, o driver `pg` serializa `date` como `Date` do JS e o JSON vira `"2023-11-21T00:00:00.000Z"` — formato feio e com timezone implícito.
- **`SUM(value)::int`**: cast pra int regular. `bigint` em pg virava string no JSON (padrão do driver). Como nosso range de valores é pequeno (0/1 somados por ano = no máximo dezenas de milhares), int regular cabe.
- **`date_time >= $3::date AND date_time < $4::date + INTERVAL '1 day'`**: o "+1 day" torna o limite superior **inclusivo no dia todo**. Evita confusão de "23:59:59 inclui ou não?". É o padrão recomendado pra ranges de data.

### Uso do índice composto
Confirmado via `EXPLAIN ANALYZE`:

```
Index Scan using idx_metric_readings_metric_datetime on metric_readings
  Index Cond: ((metric_id = 218219) AND (date_time >= '2023-11-01'::date) AND (date_time < '2023-12-01'::date))
Execution Time: 0.977 ms
```

As 3 condições do WHERE entram como `Index Cond` — o Postgres não precisa sequer ler a tabela pra descartar linhas. 363 linhas escaneadas de 93k total, em menos de 1ms.

### `ValidationPipe` global com `whitelist + forbidNonWhitelisted`
```typescript
new ValidationPipe({
  transform: true,               // aplica @Type pra converter query string -> int
  whitelist: true,               // remove props nao declaradas no DTO
  forbidNonWhitelisted: true,    // erro 400 se mandaram props estranhas
});
```

- `transform: true` é **obrigatório** com query params: sem isso, `metricId` ficaria string `"71590"` mesmo com `@IsInt()` e o `@Type(() => Number)` não faria nada.
- `forbidNonWhitelisted` é uma rede de segurança pro caller: se alguém digita `?granulariti=DAY` (typo), recebe erro claro em vez de silenciosamente usar o default.

### `@Type(() => Number)` no DTO
Query params chegam como string sempre. Sem o transform explícito, `@IsInt()` rejeita qualquer valor. Com `@Type(() => Number) + transform: true`, a string vira number antes de rodar a validação.

### Datas como string no DTO, não `Date`
`@IsDateString({ strict: true })` valida formato ISO sem converter pra `Date`. Passamos a string direto pro SQL, que faz o `::date` cast. Evita ida e volta JS ↔ Postgres com risco de timezone shift.

---

## 4. Verificação executada (2026-04-16)

### Happy path

| # | Input | Output | OK |
|---|-------|--------|----|
| A | `metricId=218219, dateInitial=2023-11-21, finalDate=2023-11-22, DAY` | 2 linhas: 266 + 96 | ✅ |
| B | `metricId=218219, dateInitial=2023-11-01, finalDate=2023-11-30, MONTH` | 1 linha: 362 | ✅ |
| C | `metricId=218219, dateInitial=2023-01-01, finalDate=2023-12-31, YEAR` | 1 linha: 362 | ✅ |
| D | Range fora dos dados (2020) | `[]` | ✅ |

**Consistência matemática:** 266 + 96 = 362 (DAY soma bate com MONTH e YEAR).

### Validações

| # | Input inválido | Resposta |
|---|---------------|----------|
| E | `metricId=abc` | 400 "metricId must be an integer number" | ✅ |
| F | `dateInitial=21/11/2023` | 400 "dateInitial deve estar em YYYY-MM-DD" | ✅ |
| G | `granularity=HOUR` | 400 "granularity deve ser DAY, MONTH ou YEAR" | ✅ |
| H | Sem `dateInitial`/`finalDate` | 400 com mensagens dos dois | ✅ |
| I | Param extra `extra=xyz` | 400 "property extra should not exist" | ✅ |

### Performance

- **Query com `EXPLAIN ANALYZE`**: Index Scan, 0.977ms pra 363 linhas scaneadas.
- **Response HTTP**: negligível (tipo 5-10ms no total).

## 5. Exemplos de uso

```bash
# diario de novembro 2023 pra uma metrica
curl "http://localhost:3001/metrics/aggregate?metricId=218219&dateInitial=2023-11-01&finalDate=2023-11-30"

# mensal do ano
curl "http://localhost:3001/metrics/aggregate?metricId=218219&dateInitial=2023-01-01&finalDate=2023-12-31&granularity=MONTH"

# anual de 5 anos
curl "http://localhost:3001/metrics/aggregate?metricId=218219&dateInitial=2020-01-01&finalDate=2025-12-31&granularity=YEAR"
```

## 6. Pendências anotadas

- **Fase 5 (relatório Excel)** vai precisar **3 queries** (DAY/MONTH/YEAR) ou uma única com as 3 agregações em colunas. Dado o shape esperado (`MetricId | DateTime | AggDay | AggMonth | AggYear`), provavelmente uma query com window functions ou 3 CTE's:
  ```sql
  WITH daily AS (SELECT ..., SUM(...) OVER (PARTITION BY day) AS agg_day, ...)
  ```
  Decide no início da Fase 5.
- **Preenchimento com zero** pra dias sem dados: `generate_series('2023-11-01', '2023-11-30', '1 day') LEFT JOIN ...`. Só se o teste exigir.
- **Paginação**: se alguém pedir `granularity=DAY` de 10 anos, são ~3650 pontos. Negligível, mas em produção valeria limite.

---

**Status:** ✅ concluída e validada em 2026-04-16.
