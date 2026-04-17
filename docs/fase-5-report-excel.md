# Fase 5 — Relatório Excel

**Objetivo:** endpoint que gera um arquivo Excel com colunas `MetricId | DateTime | AggDay | AggMonth | AggYear` pro período requisitado. Atende item 8 do enunciado.

---

## 1. Contrato

### Request

```
GET /metrics/report?metricId=218219&dateInitial=2023-11-01&finalDate=2023-11-30
```

Mesmos params do `/metrics/aggregate` **sem** `granularity` (o relatório traz as três agregações em colunas).

### Response

```
HTTP/1.1 200 OK
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="report-218219-2023-11-01_to_2023-11-30.xlsx"
Content-Length: 6618
```

Arquivo `.xlsx` com uma planilha "Report":

| MetricId | DateTime   | AggDay | AggMonth | AggYear |
|----------|------------|--------|----------|---------|
| 218219   | 21/11/2023 | 266    | 362      | 362     |
| 218219   | 22/11/2023 | 96     | 362      | 362     |

Uma linha por **dia com leitura** no range requisitado.

---

## 2. Arquivos criados / alterados

```
backend/src/
├── metrics/
│   ├── dto/report-query.dto.ts       # igual ao aggregate sem granularity
│   ├── excel-report.util.ts          # builder do workbook com exceljs
│   ├── metrics.controller.ts         # + rota GET /metrics/report
│   └── metrics.repository.ts         # + metodo report() + tipo ReportRow
backend/package.json                  # + exceljs
```

## 3. Decisões

### Semântica das agregações: sobre o **range requisitado**, não calendário completo
O enunciado mostra `AggMonth=4` nos dias de novembro e dezembro de 2023, e `AggYear=32` pros dias de 2023. Não dá pra inferir 100% da amostra se o "mês/ano" considera todos os dias do mês/ano **ou apenas os dias dentro do range**.

Escolhi: **apenas dias dentro do range**.

**Por quê:**
- Consistência visual — se eu peço 15/11 a 30/11, quero ver "AggMonth" que confere com a soma das linhas mostradas.
- SQL muito mais simples (não precisa consultar dados fora do WHERE).
- Alinhado com o endpoint `/metrics/aggregate` da Fase 4 (que já é range-bound).
- Se o reviewer quisesse "mês calendário completo", é a alternativa óbvia e fácil de trocar — é só remover o filtro de `WHERE` da subquery que alimenta a janela.

Documentei a escolha aqui porque o enunciado não é explícito.

### Uma query SQL com CTE + window functions
```sql
WITH daily AS (
  SELECT
    metric_id,
    date_trunc('day', date_time)::date AS day,
    date_trunc('month', date_time)     AS month_trunc,
    date_trunc('year', date_time)      AS year_trunc,
    SUM(value)                         AS day_sum
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
  metric_id                                          AS "metricId",
  to_char(day, 'DD/MM/YYYY')                         AS "dateTime",
  day_sum::int                                       AS "aggDay",
  (SUM(day_sum) OVER (PARTITION BY month_trunc))::int AS "aggMonth",
  (SUM(day_sum) OVER (PARTITION BY year_trunc))::int  AS "aggYear"
FROM daily
ORDER BY day
```

Por que CTE + window ao invés de 3 queries separadas:
- **1 round-trip** só.
- A CTE agrega o dia (93k linhas → N dias). As window functions operam sobre esse shape reduzido (somando os dias).
- Índice `(metric_id, date_time)` continua sendo usado no WHERE da CTE.
- `PARTITION BY month_trunc` e `PARTITION BY year_trunc` calculam separadamente — uma scan da CTE pra cada.

### Formato da data como `DD/MM/YYYY` (texto)
O enunciado mostra `01/11/2023` no exemplo. Usar `to_char(day, 'DD/MM/YYYY')` devolve string direta. Evita:
- `Date` do JS virando ISO com timezone (feio no Excel e no JSON).
- Configurar `numFmt` de cada célula do exceljs (possível mas mais trabalho e frágil).

### `exceljs` em lugar de `xlsx` (SheetJS)
- `exceljs` tem API fluente e tipagem boa.
- `xlsx` (SheetJS) é menor mas a API é mais verbose e a versão community tem pouco suporte.
- Volume esperado é pequeno (<10k linhas) — nenhuma das duas tem gargalo.

### Resposta via `StreamableFile` + `@Header()`
O padrão novo do NestJS pra retorno de arquivo:
```typescript
@Get('report')
@Header('Content-Type', XLSX_MIME)
async report(@Query() query, @Res({ passthrough: true }) res): Promise<StreamableFile> {
  const buffer = await buildReportWorkbook(rows);
  res.set('Content-Disposition', `attachment; filename="..."`);
  return new StreamableFile(buffer);
}
```

- `@Header()` seta o Content-Type estático.
- `@Res({ passthrough: true })` permite setar header dinâmico (Content-Disposition com filename variável) **sem** perder o ciclo de vida do Nest (interceptors, filters, etc).
- `StreamableFile(buffer)` serializa a resposta binária corretamente.

### Colunas com `key` e `width` no sheet
```typescript
sheet.columns = [
  { header: 'MetricId', key: 'metricId', width: 12 },
  ...
];
sheet.addRow({ metricId: 218219, dateTime: '21/11/2023', ... });
```
Com `key`, o `addRow(obj)` mapeia por nome ao invés de posição. Menos bug-prone que passar array.

---

## 4. Verificação executada (2026-04-16)

| # | Teste | Resultado |
|---|-------|-----------|
| 1 | Headers HTTP: Content-Type xlsx, Content-Disposition com filename | ✅ |
| 2 | `file(1)` identifica como "Microsoft Excel 2007+" | ✅ |
| 3 | Header do sheet exatamente `MetricId \| DateTime \| AggDay \| AggMonth \| AggYear` | ✅ |
| 4 | Linhas do CSV real: 2 dias (21/11 e 22/11) com AggDay=266/96, AggMonth=362, AggYear=362 | ✅ |
| 5 | Consistência: 266+96=362 bate com AggMonth e AggYear | ✅ |
| 6 | Validação `metricId=abc` → 400 | ✅ |
| 7 | Range fora dos dados → xlsx válido com só o header | ✅ |
| 8 | Multi-mês (fixture com out=5+3, nov=7+2): AggMonth out=8, AggMonth nov=9, AggYear=17 | ✅ |

Teste 8 foi crítico: prova que `PARTITION BY month_trunc` separa corretamente outubro de novembro, e que `PARTITION BY year_trunc` agrega os dois.

## 5. Exemplos de uso

```bash
# relatorio de um mes
curl -OJ "http://localhost:3001/metrics/report?metricId=218219&dateInitial=2023-11-01&finalDate=2023-11-30"

# relatorio do ano inteiro (dados so em nov, entao so 2 linhas)
curl -OJ "http://localhost:3001/metrics/report?metricId=218219&dateInitial=2023-01-01&finalDate=2023-12-31"
```

O flag `-OJ` do curl usa o filename do `Content-Disposition`.

## 6. Pendências / considerações

- **Streaming pro browser:** hoje geramos o buffer inteiro em memória e entregamos. Pra arquivos enormes (>50MB), `exceljs` suporta `stream.xlsx.WorkbookWriter` que escreve direto no response. Fica como melhoria — não cabe pra o volume esperado deste teste.
- **Cache de relatórios:** idempotência natural permite cache-by-URL. Seria fácil ligar Redis com chave = (metricId, range) e TTL curto. Pendente.
- **Permissão / autenticação:** endpoints abertos hoje. Qualquer melhoria de segurança (auth, rate limit) vale citar no README final.

---

**Status:** ✅ concluída e validada em 2026-04-16.
