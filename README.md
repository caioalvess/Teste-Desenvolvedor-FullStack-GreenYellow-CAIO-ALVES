# GreenYellow — Teste Full Stack

> Pipeline de ingestão e análise de leituras de métricas: **upload CSV → Azurite (blob) → RabbitMQ → consumer (streaming) → Postgres → endpoints de agregação e relatório Excel → front Angular + PrimeNG**.

---

## 1. Visão geral

O projeto atende aos 12 itens do enunciado. Em linhas gerais:

- **Upload** de um CSV (até 500MB) pra um endpoint da API NestJS. O arquivo é **streamed** direto pro Azurite Blob Storage, sem bufferar em memória. Uma mensagem com o nome do blob é publicada no RabbitMQ.
- **Consumer** escuta a fila, baixa o blob como stream, parseia com `csv-parse` async, acumula em batches de 1000 linhas e insere no Postgres via SQL puro com `ON CONFLICT DO NOTHING` (idempotente).
- **Agregações** (`GET /metrics/aggregate`) e **relatório Excel** (`GET /metrics/report`) são queries SQL puras com `date_trunc`, window functions (`SUM() OVER (PARTITION BY ...)`) e uso garantido do índice composto.
- **Front Angular 17** (standalone components + signals) com PrimeNG: 1 card de upload, 1 card de consulta/tabela, botão de download do Excel.
- Tudo roda com um `docker compose up -d`. Imagens de produção separadas (multi-stage) com nginx servindo o front.

**Não funcional:**
- **Streaming end-to-end** comprovado: 1.2M linhas / 31MB com pico de RAM de **+53 MiB** sobre baseline.
- **25 testes automatizados** (unit parser + integração com DB real + E2E com Rabbit/Azurite/Postgres).
- **Idempotência** garantida pelo constraint `UNIQUE (metric_id, date_time)` + `ON CONFLICT DO NOTHING`.

---

## 2. Arquitetura

```
 ┌──────────────────┐         ┌─────────────┐
 │  Angular 17 SPA  │  HTTP   │  NestJS 10  │
 │  PrimeNG + SCSS  ├────────>│    API      │
 │  (4200 | 8080)   │         │ (3001|3003) │
 └──────────────────┘         └──────┬──────┘
                          MulterEngine │
                      streaming upload │
                                       ▼
                              ┌──────────────┐
                              │   Azurite    │
                              │ Blob Storage │◄───── stream download
                              │   (10000)    │              │
                              └──────┬───────┘              │
                    mensagem com     │                      │
                    nome do blob     ▼                      │
                              ┌──────────────┐              │
                              │  RabbitMQ 3  │              │
                              │ csv.uploaded │              │
                              │    (5672)    │              │
                              └──────┬───────┘              │
                                     │ consume              │
                                     ▼                      │
                              ┌──────────────┐              │
                              │  Consumer    │──────────────┘
                              │ (mesmo proc) │
                              │ csv-parse    │
                              │ async stream │
                              │ batch insert │
                              └──────┬───────┘
                                     │
                                     ▼
                              ┌──────────────┐
                              │ Postgres 16  │
                              │ metric_read… │
                              │    (5432)    │
                              └──────────────┘
```

**5 containers** na stack dev, **7** quando prod + dev coexistem. Todos na mesma rede do compose, falando por nome de service (`postgres`, `rabbitmq`, `azurite`).

---

## 3. Stack

| Camada | Tech |
|--------|------|
| Backend | NestJS 10, TypeScript 5.7, Node 20 |
| Banco | PostgreSQL 16 + TypeORM (entities) / SQL puro (queries) |
| Fila | RabbitMQ 3 + amqplib |
| Storage | Azurite (emulador Azure Blob) + @azure/storage-blob |
| Upload | Multer 2.x + custom `StorageEngine` que streama pro Azurite |
| CSV | `csv-parse` (async/streaming) |
| Excel | `exceljs` |
| Validação | class-validator + class-transformer + ValidationPipe global |
| Testes | Jest + ts-jest + supertest + `@nestjs/testing` |
| Frontend | Angular 17 (standalone), PrimeNG 17.18, RxJS, SCSS |
| Servidor estático (prod) | nginx:alpine com gzip + cache `immutable` + SPA fallback |
| Orquestração | Docker Compose v2 (multi-stage Dockerfiles, profiles) |

---

## 4. Como rodar

### Pré-requisitos
- Docker Engine 20+ e Docker Compose v2+
- ~4 GB livres em disco (imagens + volumes)

### Dev (hot reload)

```bash
git clone <repo>
cd teste-desenvolvedor
cp .env.example .env
docker compose up -d
```

Aguarde ~30s na primeira execução (build das imagens dev). Depois:

| Serviço | URL |
|---------|-----|
| **Frontend** | http://localhost:4200 |
| API (`GET /health`) | http://localhost:3001/health |
| RabbitMQ management | http://localhost:15672 (login `gy_user` / `gy_password`) |

Hot reload ativo: qualquer alteração em `backend/src/**` ou `frontend/src/**` recompila automaticamente.

### Testes

```bash
docker compose exec api npm test          # 25 testes em ~8s
docker compose exec api npm run test:cov  # com cobertura
```

Detalhes do que é testado em [`docs/fase-7-testes.md`](docs/fase-7-testes.md).

### Produção (imagens otimizadas)

```bash
docker compose --profile prod up -d
```

Sobe **também** os serviços de produção (mantém dev rodando por padrão, com portas distintas):

| Serviço | URL |
|---------|-----|
| **Frontend prod** (nginx) | http://localhost:8080 |
| API prod | http://localhost:3003/health |

Pra rodar só produção (sem dev):
```bash
docker compose stop api frontend
docker compose --profile prod up -d api-prod frontend-prod postgres rabbitmq azurite
```

### Parar / limpar

```bash
docker compose down           # para containers, mantém volumes (dados)
docker compose down -v        # para + apaga volumes (reset total)
```

---

## 5. Pipeline de uso

1. **Abrir** `http://localhost:4200`.
2. Clicar em **"Selecionar CSV"** (ou arrastar) → escolher `arquivo-modelo.csv`.
3. Aguardar a mensagem verde "Arquivo enviado: ...". Os 3 campos de filtro são preenchidos automaticamente a partir do CSV.
4. Ajustar **MetricId**, **Data inicial**, **Data final**, escolher **Dia / Mês / Ano**.
5. Clicar **Consultar** → tabela com os valores agregados.
6. Clicar **Baixar Excel** → arquivo `.xlsx` com colunas `MetricId | DateTime | AggDay | AggMonth | AggYear`.

### 5.1 Dataset de demonstração (metric 999)

Pra demonstrar cenários com **muitos pontos** (paginação ativa, 60+ resultados), há um seed SQL que popula o banco com dados sintéticos:

```bash
docker exec -i gy-postgres psql -U gy_user -d gy_metrics < db/seed-demo.sql
```

Cria 1440 leituras para `metricId 999` (60 dias × 24 horas, Jan-Fev/2024). Idempotente via `ON CONFLICT DO NOTHING`.

**Regra do front:** os botões "Consultar" e "Baixar Excel" ficam desabilitados até que (a) os 3 campos de filtro estejam preenchidos E (b) um CSV tenha sido enviado. **Exceção:** `metricId === 999` é reconhecido como dataset pré-seedeado e libera os botões sem precisar do upload — isso permite testar o fluxo de muitos resultados / paginação sem precisar gerar um CSV grande.

**Para testar paginação:**
- MetricId: `999`
- Data inicial: `01-01-2024`
- Data final: `01-03-2024`
- Granularidade: `Dia`
- Resultado: 60 pontos em 8 páginas.

Via curl:
```bash
# upload
curl -X POST http://localhost:3001/uploads -F "file=@arquivo-modelo.csv"

# aggregate
curl "http://localhost:3001/metrics/aggregate?metricId=218219&dateInitial=2023-11-21&finalDate=2023-11-22&granularity=DAY"

# excel
curl -OJ "http://localhost:3001/metrics/report?metricId=218219&dateInitial=2023-11-01&finalDate=2023-11-30"
```

---

## 6. Estrutura do repo

```
.
├── backend/                   # API NestJS (hot reload em dev)
│   ├── src/
│   │   ├── azurite/           # cliente singleton do Blob, streaming
│   │   ├── rabbitmq/          # conexão/canal, publish/consume
│   │   ├── uploads/           # POST /uploads + StorageEngine streaming
│   │   ├── consumer/          # consome fila, parseia, insere
│   │   ├── metrics/           # entidade, repo SQL puro, endpoints, DTO
│   │   ├── database/          # TypeORM forRootAsync
│   │   ├── health/            # GET /health (3 checks)
│   │   ├── app.module.ts
│   │   └── main.ts            # bootstrap + CORS + ValidationPipe
│   ├── test/
│   │   └── pipeline.e2e.spec.ts
│   ├── Dockerfile             # multi-stage: dev + prod
│   └── jest.config.js
├── frontend/                  # Angular 17 + PrimeNG
│   ├── src/app/
│   │   ├── upload/            # <p-fileUpload>
│   │   ├── dashboard/         # form + <p-table> + botao Excel
│   │   ├── api.service.ts
│   │   ├── models.ts
│   │   ├── app.component.ts   # layout com toolbar
│   │   └── app.config.ts      # providers (HttpClient, animations)
│   ├── Dockerfile             # multi-stage: dev + prod (nginx)
│   └── nginx.conf             # SPA fallback + gzip + cache
├── docs/                      # DOCUMENTACAO POR FASE (leia!)
├── docker-compose.yml         # 5 services + 2 opcionais (profile prod)
├── .env.example
├── arquivo-modelo.csv         # dados de exemplo do enunciado
├── teste-desenvolvedor.pdf    # enunciado
└── README.md                  # este arquivo
```

---

## 7. Principais decisões técnicas

Cada fase tem doc próprio com rationale e trade-offs. Resumo:

| Decisão | Onde | Por quê |
|---------|------|---------|
| **Tabela crua** `metric_readings`, não pré-agregada | [fase-3](docs/fase-3-consumer-postgres.md) | Flexibilidade de range/granularity via `date_trunc` com índice composto |
| **`UNIQUE (metric_id, date_time)`** + `ON CONFLICT DO NOTHING` | [fase-3](docs/fase-3-consumer-postgres.md) | Idempotência: reupload ou reprocesso não duplica |
| **Streaming ponta a ponta** (upload + download + parse + batch insert) | [fase-6.5](docs/fase-6.5-streaming.md) | Memória O(1) vs O(arquivo). +53MiB pra 1.2M linhas |
| **1 transação por batch**, não por arquivo | [fase-6.5](docs/fase-6.5-streaming.md) | Evita lock/WAL de longo prazo; ON CONFLICT cobre retry |
| **SQL puro** via `dataSource.query(sql, params)` | [fase-3](docs/fase-3-consumer-postgres.md), [fase-4](docs/fase-4-aggregate-endpoint.md), [fase-5](docs/fase-5-report-excel.md) | Item 5 do enunciado; controle fino do plano |
| **`to_char(date_trunc(...), 'YYYY-MM-DD')`** em vez de cast pra `Date` | [fase-4](docs/fase-4-aggregate-endpoint.md) | Evita serialização ISO com TZ implícita |
| **Window functions** (`SUM OVER PARTITION BY`) no report | [fase-5](docs/fase-5-report-excel.md) | 1 query, não 3; range-bound pras 3 agregações |
| **`AggYear/AggMonth` range-bound** (não calendário global) | [fase-5](docs/fase-5-report-excel.md) | Consistência visual com a tabela; documentado |
| **Multer custom `StorageEngine`** pipa direto pro Azurite | [fase-6.5](docs/fase-6.5-streaming.md) | Arquivo nunca vira Buffer na API |
| **Multi-stage Dockerfile** com targets `dev` e `prod` | [fase-7.5](docs/fase-7.5-docker-prod-backend.md), [fase-7.6](docs/fase-7.6-docker-prod-frontend.md) | Um arquivo, duas imagens; prod é 13× menor no frontend |
| **Nginx:alpine** pro front prod com SPA fallback e cache imutável | [fase-7.6](docs/fase-7.6-docker-prod-frontend.md) | Industrial-grade, zero Node no runtime |
| **Profile `prod`** no compose | [fase-7.7](docs/fase-7.7-compose-profile-prod.md) | `docker compose --profile prod up` sobe stack de deploy |
| **Testes E2E com DB/Rabbit/Azurite reais** isolados via env | [fase-7 testes](docs/fase-7-testes.md) | Testa o fluxo exato de prod, não mocks |
| **`synchronize: true` em dev** (não migrations) | [fase-3](docs/fase-3-consumer-postgres.md) | Velocidade; documentado como melhoria pra prod |
| **`nack(requeue=false)` em erro do consumer** | [fase-3](docs/fase-3-consumer-postgres.md) | Evita loop infinito; DLQ é melhoria anotada |

---

## 8. Variáveis de ambiente

Configuração em `.env` (exemplo em `.env.example`):

| Var | Default | Uso |
|-----|---------|-----|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `gy_user` / `gy_password` / `gy_metrics` | Postgres |
| `POSTGRES_PORT` | 5432 | porta host |
| `RABBITMQ_USER` / `RABBITMQ_PASSWORD` | `gy_user` / `gy_password` | Rabbit |
| `RABBITMQ_PORT` / `RABBITMQ_MGMT_PORT` | 5672 / 15672 | portas host |
| `AZURITE_ACCOUNT_NAME` / `AZURITE_ACCOUNT_KEY` | `devstoreaccount1` / key do emulador | credenciais fixas (público, padrão Azurite) |
| `AZURITE_BLOB_PORT` / `QUEUE_PORT` / `TABLE_PORT` | 10000–10002 | portas host |
| `API_PORT` | 3001 | porta host (dev) |
| `FRONTEND_PORT` | 4200 | porta host (dev) |
| `API_PROD_PORT` | 3003 | porta host (prod, perfil `prod`) |
| `FRONTEND_PROD_PORT` | 8080 | porta host (prod) |
| `CORS_ORIGIN` | `http://localhost:4200` | origem permitida pela API |
| `UPLOAD_QUEUE_NAME` | `csv.uploaded` | nome da fila (override no E2E pra `csv.uploaded.test`) |
| `BLOB_CONTAINER` | `csv-uploads` | nome do container de blobs |

---

## 9. Limitações conhecidas

- **Render visual do front não verificado neste ambiente** (sem browser headless disponível). Contratos HTTP, build e E2E do backend estão cobertos. Walkthrough manual documentado em [fase-6](docs/fase-6-frontend-angular.md) seção 6.
- **Sem DLQ no RabbitMQ**: erro no consumer → `nack(requeue=false)` → mensagem é descartada. Em prod, DLQ + retry com backoff seria o certo. Anotado.
- **Sem migrations TypeORM**: dev usa `synchronize: true`. Pra prod, criar migrations é o passo seguinte. Anotado.
- **Sem autenticação**: endpoints abertos. Pra prod real, JWT + role guards. Fora de escopo do teste.
- **Upload limit 500MB**: arbitrário, configurável no `MulterModule.registerAsync`. Pra volumes maiores, `uploadStream` já suporta, mas considerar rate-limit.
- **Consumer single-instance**: com prefetch default, múltiplas mensagens são roteadas round-robin se rodasse réplicas. Em prod valeria `channel.prefetch(N)` explícito.
- **Excel report é buffered** (não streaming). Pra relatórios gigantes (>10k linhas) o `exceljs` tem stream writer — melhoria anotada.

---

## 10. Melhorias futuras (roadmap informal)

Em ordem decrescente de impacto:

1. **TypeORM Migrations** (substituir `synchronize: true` em prod)
2. **DLQ + retry com backoff** no consumer
3. **Testes E2E com Playwright** pro frontend (render + interação real)
4. **Autenticação** (JWT ou OAuth) + authorization por role
5. **Stream do Excel** pra relatórios >10k linhas
6. **Observability**: OpenTelemetry (traces, métricas, logs estruturados)
7. **pg-copy-streams** no insert pra arquivos >10M linhas (COPY é ~10× mais rápido que INSERT em lote)
8. **Rate limit** no endpoint de upload
9. **Compressão** do blob no Azurite (gzip pré-upload)
10. **Lazy load** do PrimeNG pra reduzir bundle inicial (hoje 922KB, default 500KB warn)

---

## 11. Fases do projeto (docs)

| # | Fase | Doc |
|---|------|-----|
| 0 | Infra externa no Docker (postgres/rabbit/azurite) | [docs/fase-0-infra-docker.md](docs/fase-0-infra-docker.md) |
| 1 | Scaffold NestJS + healthcheck dos 3 serviços | [docs/fase-1-nestjs-healthcheck.md](docs/fase-1-nestjs-healthcheck.md) |
| 2 | Endpoint `POST /uploads` (Azurite + publish no Rabbit) | [docs/fase-2-upload-azurite-rabbit.md](docs/fase-2-upload-azurite-rabbit.md) |
| 3 | Consumer + parser CSV + Postgres (+ SQL puro + ON CONFLICT) | [docs/fase-3-consumer-postgres.md](docs/fase-3-consumer-postgres.md) |
| 4 | `GET /metrics/aggregate` (DAY/MONTH/YEAR) | [docs/fase-4-aggregate-endpoint.md](docs/fase-4-aggregate-endpoint.md) |
| 5 | `GET /metrics/report` (Excel com CTE + window functions) | [docs/fase-5-report-excel.md](docs/fase-5-report-excel.md) |
| 6 | Frontend Angular + PrimeNG | [docs/fase-6-frontend-angular.md](docs/fase-6-frontend-angular.md) |
| 6.5 | **Streaming ponta a ponta** (stress test 1.2M linhas) | [docs/fase-6.5-streaming.md](docs/fase-6.5-streaming.md) |
| 7.1–7.4 | Testes automatizados (25 tests, 3 suites) + o que não foi testado e por quê | [docs/fase-7-testes.md](docs/fase-7-testes.md) |
| 7.5 | Dockerfile multi-stage prod backend | [docs/fase-7.5-docker-prod-backend.md](docs/fase-7.5-docker-prod-backend.md) |
| 7.6 | Dockerfile multi-stage prod frontend + nginx | [docs/fase-7.6-docker-prod-frontend.md](docs/fase-7.6-docker-prod-frontend.md) |
| 7.7 | Profile `prod` no compose | [docs/fase-7.7-compose-profile-prod.md](docs/fase-7.7-compose-profile-prod.md) |
| 7.8 | Redesign do frontend (tema GreenYellow, dark mode, split layout) | [docs/fase-7.8-frontend-polish.md](docs/fase-7.8-frontend-polish.md) |
| 7.9 | Polimento final (`.gitignore`, healthcheck front, regressão) | [docs/fase-7.9-polimento.md](docs/fase-7.9-polimento.md) |

---

## 12. Checklist do enunciado

| Item | Atendido |
|------|----------|
| 1. Upload → Azurite + publish Rabbit (NestJS) | ✅ |
| 2. Conectar à fila e consumir | ✅ |
| 3. Ler arquivo do storage | ✅ (streaming) |
| 4. Modelar banco Postgres | ✅ |
| 5. Entities ORM + **consultas em SQL puro** | ✅ |
| 6. Armazenar todos os dados do arquivo | ✅ |
| 7. Endpoint de agregação DAY/MONTH/YEAR | ✅ |
| 8. Endpoint de relatório Excel | ✅ |
| 9. Angular + ng-prime (upload, visualização, download) | ✅ (render visual: walkthrough manual) |
| 10. Configuração Docker | ✅ (dev + prod via profile) |
| 11. Repositório Git | ⚠️ Pendente (a subir) |
| 12. Documentação + justificativa de testes não implementados | ✅ (`docs/` + seção 9 deste README) |
