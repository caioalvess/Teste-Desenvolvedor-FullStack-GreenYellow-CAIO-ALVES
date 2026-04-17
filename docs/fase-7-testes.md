# Fase 7.1–7.3 — Testes automatizados

O enunciado (item 12) pede explicitamente que a documentação descreva **o que tem e o que não tem teste, e por quê**. Essa é a prestação de contas.

---

## Resumo

**25 testes automatizados**, distribuídos em 3 suites:

| Suite | Tipo | Testes | Tempo |
|-------|------|--------|-------|
| `src/metrics/csv-parser.util.spec.ts` | Unit | 9 | ~1s |
| `src/metrics/metrics.repository.spec.ts` | Integração com Postgres real | 13 | ~3s |
| `test/pipeline.e2e.spec.ts` | E2E (app Nest + Rabbit + Azurite + DB) | 3 | ~4s |
| **Total** | | **25** | **~8s** |

Rodar: `docker compose exec api npm test`

---

## 1. O que TEM teste

### 1.1 Parser do CSV (`csv-parser.util.spec.ts`)

A função mais "determinística e dependente de dados" do sistema. Cobertura:

| Caso | Valor do teste |
|------|----------------|
| Happy path: header + linhas → `ParsedRow` | Contrato básico |
| **UTF-8 BOM removido** | Regressão do bug real pego na Fase 3 |
| CRLF aceito | Arquivos do Windows/Excel |
| **`;;` vazios no fim ignorados** | Regressão do outro bug real da Fase 3 |
| `metricId=abc` → throw com linha 3 | Validação com mensagem útil |
| `dateTime=2024-01-01 12:00` (ISO) → throw com linha 2 | Formato DD/MM/YYYY obrigatório |
| 25 linhas com `batchSize=10` → batches `[10,10,5]` | Correção do streaming (Fase 6.5) |
| Input só com header → 0 batches | Edge case |
| Ordem preservada entre batches | Invariante do streaming |

**Modo de teste:** `Readable.from(Buffer)` simula o stream do Azurite. Zero mocks do `csv-parse` — a gente testa o mesmo código que roda em produção.

### 1.2 Repository (`metrics.repository.spec.ts`)

Integração real com Postgres. Banco separado (`gy_metrics_test`) pra não sujar dev. `dropSchema + synchronize` no boot, `TRUNCATE` entre testes.

**`insertBatch`** (3 testes):
- Insere em lote + retorna quantidade
- ON CONFLICT ignora duplicatas em `(metric_id, date_time)`
- Array vazio → 0 sem tocar no banco

**`aggregate`** (6 testes):
- `DAY` soma por dia, ordenado
- `MONTH` soma o mês, retorna primeiro dia
- `YEAR` soma o ano
- Isolamento por `metric_id` (métrica 999 não vaza na query de 100)
- Range vazio → `[]`
- Range **inclusivo** nos dois extremos

**`report`** (4 testes):
- Formato `DD/MM/YYYY` + colunas `aggDay/Month/Year`
- Multi-mês: `aggMonth` distingue, `aggYear` agrega
- **Range-bound**: dia fora do range não conta no `aggYear` (valida a decisão documentada na Fase 5)
- Range sem dados → `[]`

### 1.3 E2E (`test/pipeline.e2e.spec.ts`)

Sobe o `AppModule` real dentro do Jest (via `@nestjs/testing`), usa Rabbit + Azurite + Postgres de verdade. Isolamento do ambiente de dev via env:
- `POSTGRES_DB=gy_metrics_test` — outro DB
- `BLOB_CONTAINER=csv-uploads-test` — outro container
- `UPLOAD_QUEUE_NAME=csv.uploaded.test` — outra fila (dev consumer não rouba)

**Teste 1 — pipeline completo:**
1. `POST /uploads` com CSV de 3 linhas → 201 + blobName esperado
2. `waitFor` polla o DB até ver 3 linhas (consumer real processando)
3. `GET /metrics/aggregate` DAY/MONTH → valores exatos esperados
4. `GET /metrics/report` → Content-Type xlsx + Content-Disposition + magic bytes `PK` (xlsx é zip)

**Teste 2** — `POST /uploads` com `.txt` → 400
**Teste 3** — `GET /metrics/aggregate?metricId=abc` → 400

---

## 2. O que NÃO tem teste (e por quê)

### 2.1 Componentes Angular (upload/dashboard)
**Motivo:** este ambiente não tem browser headless (Chromium/Playwright). Testar Angular standalone components com render real precisaria setup de Karma ou Playwright, que adiciona ~300MB de deps e mais tempo de CI do que o valor que agrega pra um teste de 2 componentes com lógica mínima. O front só wrappa o `ApiService` — a camada de lógica **está** coberta pelo backend.

**Mitigação:** o E2E do backend prova o contrato HTTP. O front consome esse contrato. Validação visual documentada na Fase 6 exige um walkthrough manual no browser.

**Se fosse produção:** colocaria Playwright num job de CI separado, só pra happy path do front.

### 2.2 Integração com Azure real (cloud)
**Motivo:** o teste usa **Azurite** (emulador oficial da Microsoft), que é indistinguível do Azure real do ponto de vista do SDK. Rodar contra Azure cloud precisaria credencial, subscription, billing — e o emulador é precisamente o que a Microsoft recomenda pra testes locais.

**Se fosse produção:** um smoke test num environment de staging apontando pro Azure real, rodado em deploy.

### 2.3 Cenários de falha de infra
- Rabbit cai com mensagens em voo → re-consumir após reconexão
- Postgres derruba conexão no meio de um batch → rollback da transação
- Azurite timeout no download do blob → nack da mensagem
- Network partition entre API e infra

**Motivo:** testar esses cenários confiavelmente exige toxiproxy ou chaos mesh pra simular falhas programaticamente. Isso **quadruplica** a complexidade do setup de teste. Pro escopo do teste de avaliação, o ROI é baixo — o código já tem os handlers certos (try/catch + nack, client.end() em finally) e a idempotência via `ON CONFLICT` cobre reprocessamento.

**Se fosse produção:** teste de chaos engineering no pipeline de CI/CD, não no test runner unit/integration.

### 2.4 Concorrência de uploads
**Motivo:** o sistema é desenhado pra ser seguro sob concorrência (conexão singleton no Rabbit, azurite, Multer cria streams independentes, `ON CONFLICT` no insert). Testar racing conditions confiavelmente precisa de ferramentas específicas (ex.: `jest-worker` manual, ou teste de carga com k6). Se fosse testar, o ganho real está em **teste de carga** mais do que em assertions.

**Mitigação manual:** na Fase 6.5 fiz o stress test de 1.2M linhas e observei comportamento correto + memória bounded.

### 2.5 Arquivos muito grandes (centenas de MB ou GB)
**Motivo:** validado **manualmente** na Fase 6.5 com CSV sintético de 31MB / 1.2M linhas, medindo RAM via `docker stats` durante processamento. Automatizar esse teste no Jest seria lento (90s+) e frágil (depende do hardware).

**Documentado em:** `docs/fase-6.5-streaming.md` com números exatos reproduzíveis.

### 2.6 CORS configurável
**Motivo:** é uma linha de código (`app.enableCors({ origin: ... })`). Teste unitário disso seria maior que o código que testa. No E2E, o `supertest` usa o mesmo process — CORS é um header que só faz sentido entre origens, e os testes não atravessam origem.

**Verificação manual:** feita na Fase 6 com `curl -H "Origin: http://localhost:4200"` → retornou headers corretos.

### 2.7 `RabbitMqService`, `AzuriteService` isolados
**Motivo:** esses services são **wrappers** de libs externas (amqplib, @azure/storage-blob). Testá-los em unitário exigiria mockar as libs — ou seja, testar o mock, não o comportamento real. O E2E já exercita ambos no fluxo completo.

Se um bug aparecer especificamente num edge case (ex.: stream corrompido do Azurite), aí vale teste focado — por ora, o E2E cobre o caminho quente.

### 2.8 `HealthController`
**Motivo:** cobertura por manualmente rodar `curl localhost:3001/health` na validação de cada fase (Fase 1 tem isso explícito) + **path parcialmente coberto** pelo E2E porque o `AppModule` instancia o controller e ele precisa não quebrar o boot. Bug de regressão clássico (ex.: breaking change em algum check) apareceria no E2E via timeout/erro.

### 2.9 `buildReportWorkbook` (exceljs util)
**Motivo:** função pura de formatação, validada no E2E pelo **magic bytes `PK` + content-type**. Validar célula a célula não agrega — o que importa é (a) é um xlsx válido, (b) os números vêm corretos. Ambos estão cobertos.

---

## 3. Cobertura efetiva

Rodar `docker compose exec api npm run test:cov` gera o coverage. Os arquivos de domínio críticos (parser, repository, controller de métricas) têm cobertura alta; infra (main.ts, services wrappers) tem cobertura via E2E.

**O que importa não é o número de cobertura em si, mas as decisões:** os casos mais suscetíveis a regressão (parser de CSV com suas 3 armadilhas, SQL da agregação range-bound, idempotência do insert, pipeline end-to-end) **têm** teste explícito.

---

## 4. Como rodar

```bash
# suite completa
docker compose exec api npm test

# com cobertura
docker compose exec api npm run test:cov

# em watch (durante desenvolvimento)
docker compose exec api npm run test:watch

# apenas unit (parser)
docker compose exec api npm test -- csv-parser

# apenas repository
docker compose exec api npm test -- metrics.repository

# apenas E2E
docker compose exec api npm test -- pipeline.e2e
```

**Pré-requisito:** `docker compose up -d` (os testes usam Rabbit/Azurite/Postgres reais).

---

**Status:** ✅ 25/25 testes verdes, 3 suites, decisões documentadas.
