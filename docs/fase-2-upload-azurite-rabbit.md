# Fase 2 — Upload: Azurite + RabbitMQ

**Objetivo:** endpoint que recebe um CSV via multipart, grava no Azurite Blob Storage e publica mensagem no RabbitMQ com o nome do blob. Atende itens 1 e 2 do enunciado (produção na fila; consumo vem na Fase 3).

---

## 1. Arquivos criados / alterados

```
backend/src/
├── app.module.ts                         # + AzuriteModule, RabbitMqModule, UploadsModule
├── azurite/
│   ├── azurite.module.ts                 # @Global, exporta AzuriteService
│   └── azurite.service.ts                # bootstrap do container + upload/download/list
├── rabbitmq/
│   ├── rabbitmq.module.ts                # @Global, exporta RabbitMqService
│   └── rabbitmq.service.ts               # bootstrap da fila + publish
└── uploads/
    ├── uploads.module.ts
    ├── uploads.controller.ts             # POST /uploads (multipart)
    └── uploads.service.ts                # orquestra: grava blob -> publica mensagem
backend/package.json                      # + @types/multer
```

## 2. Convenções adotadas

| Item | Valor |
|------|-------|
| Blob container | `csv-uploads` |
| Fila Rabbit | `csv.uploaded` |
| Nome do blob | `${uuid}-${originalName}` (UUID v4 pra evitar colisão se subirem o mesmo arquivo 2x) |
| Payload da mensagem | `{ blobName, originalName, uploadedAt, size }` em JSON, `content-type: application/json` |
| Durabilidade | Fila `durable: true`, mensagens `persistent: true` (sobrevivem a restart do Rabbit) |
| Limite de upload | 50MB por arquivo (`FileInterceptor.limits.fileSize`) |
| Validação | Content-Type do form precisa ser `multipart/form-data`; nome tem que terminar em `.csv` |

## 3. Decisões de arquitetura

### Dois módulos "de infra" separados (`azurite/` e `rabbitmq/`)
Ao invés de deixar a lógica embutida no `UploadsService`, isolei clientes de Azurite e RabbitMQ em módulos próprios e marquei como `@Global()`. Motivos:
- **Reuso:** Fase 3 (consumer) vai ler do Azurite e consumir da fila — os mesmos serviços.
- **Singleton real:** o `BlobServiceClient` e o canal AMQP são criados **uma vez** em `onModuleInit` e reusados. Abrir/fechar a cada request seria desperdício.
- **Separation of concerns:** `uploads/` cuida de HTTP e orquestração; `azurite/`/`rabbitmq/` cuidam das conexões.

### Bootstrap idempotente em `onModuleInit`
- `AzuriteService`: `container.createIfNotExists()` → criando ou reconhecendo que já existe.
- `RabbitMqService`: `channel.assertQueue(name, { durable: true })` → idempotente por natureza.
- Log diferencia "created" vs "already exists" pra facilitar debug na primeira subida vs restarts.

### Mensagem contém `blobName`, não o conteúdo
A mensagem na fila é pequena (161 bytes) — só metadata. O conteúdo do arquivo fica no blob store. Vantagens:
- Fila permanece leve (mensagens grandes em AMQP matam throughput).
- Desacopla: se o consumer cair, o arquivo já tá seguro no blob pra ser processado depois.
- Múltiplos consumers poderiam processar blobs diferentes em paralelo no futuro.

### `UUID` + nome original como chave do blob
- UUID evita colisão (mesmo CSV subido 2x vira 2 blobs distintos).
- Manter o nome original ajuda a identificar "o que é isso?" ao listar o container ou ler a mensagem.
- `replace(/[^\w.\-]+/g, '_')` sanitiza caracteres estranhos — Azure permite muito, mas evitar barras e unicode exótico simplifica.

### `persistent: true` + `durable: true`
- `durable: true` na fila → metadata sobrevive a restart do Rabbit.
- `persistent: true` (delivery_mode=2) na mensagem → mensagem é escrita em disco antes do broker dar ack. Se o Rabbit morrer com mensagens em voo, elas voltam depois do restart.
- Custo: um pouco mais de I/O. Ganho: não perde upload se o broker reinicia.

### `FileInterceptor` default (memoryStorage) vs disk
O default do Multer via NestJS é memória — `file.buffer` vem populado direto. Alternativa é `diskStorage` que grava em `/tmp` primeiro. Pra arquivos até 50MB, memória é mais rápido e evita I/O temp. Acima disso, consideraríamos streaming direto pro Azurite (`uploadStream`), mas por enquanto buffer funciona.

### Sem transação distribuída upload ↔ publish
Se o upload pro Azurite dá certo mas o publish falha, o blob fica "órfão". Escolhi não tentar desfazer (delete do blob) porque:
- A fase 3 pode detectar blobs órfãos periodicamente se for requisito.
- Adicionar compensação aqui complica sem ganho real no escopo atual.
- Anotado como pendência — entra na seção "Melhorias" do README final.

---

## 4. Endpoint `POST /uploads`

### Request
```
POST /uploads
Content-Type: multipart/form-data

file=@caminho/para/arquivo.csv
```

### Responses

**201 Created** — sucesso:
```json
{
  "blobName": "0a174ec9-1f3e-400c-b68d-b43445efb659-arquivo-modelo.csv",
  "originalName": "arquivo-modelo.csv",
  "uploadedAt": "2026-04-17T01:01:03.922Z",
  "size": 2453760
}
```

**400 Bad Request** — arquivo ausente:
```json
{ "message": "campo \"file\" obrigatorio no multipart/form-data", "error": "Bad Request", "statusCode": 400 }
```

**400 Bad Request** — não é `.csv`:
```json
{ "message": "apenas arquivos .csv sao aceitos", "error": "Bad Request", "statusCode": 400 }
```

## 5. Fluxo

```
Cliente                Controller          UploadsService      AzuriteService        RabbitMqService
  │                       │                      │                    │                    │
  │─ POST /uploads ──────>│                      │                    │                    │
  │   (CSV multipart)     │                      │                    │                    │
  │                       │─ handleUpload(file)─>│                    │                    │
  │                       │                      │─ uploadBlob ──────>│                    │
  │                       │                      │                    │── PUT /blob ─────> Azurite
  │                       │                      │<── {name, size}────│                    │
  │                       │                      │─ publish(msg) ──────────────────────────>│
  │                       │                      │                    │          channel.sendToQueue
  │                       │<── UploadedMessage ──│                    │                    │
  │<── 201 + JSON ────────│                      │                    │                    │
```

## 6. Como rodar / testar

```bash
# garantir tudo up
cd /dados/teste-desenvolvedor
docker compose up -d

# upload do CSV modelo
curl -X POST http://localhost:3001/uploads \
  -F "file=@arquivo-modelo.csv"

# conferir fila
curl -s -u gy_user:gy_password http://localhost:15672/api/queues/%2F/csv.uploaded \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['messages'],'mensagens pendentes')"

# espiar uma mensagem (sem consumir)
curl -s -u gy_user:gy_password -X POST \
  -H "Content-Type: application/json" \
  -d '{"count":1,"ackmode":"ack_requeue_true","encoding":"auto"}' \
  http://localhost:15672/api/queues/%2F/csv.uploaded/get

# listar blobs no Azurite
docker compose exec api node -e "
const { BlobServiceClient } = require('@azure/storage-blob');
const c = BlobServiceClient.fromConnectionString(process.env.AZURITE_CONNECTION_STRING).getContainerClient('csv-uploads');
(async () => { for await (const b of c.listBlobsFlat()) console.log(b.name, b.properties.contentLength); })();
"
```

## 7. Verificação executada (2026-04-16)

| # | Teste | Resultado |
|---|-------|-----------|
| A | `POST /uploads` sem arquivo | 400 com mensagem clara ✓ |
| B | `POST /uploads` com `.txt` | 400 com mensagem clara ✓ |
| C | `POST /uploads` com o CSV modelo | 201 + JSON com `blobName`, `size=2453760` ✓ |
| D | Fila tem 1 mensagem, `durable: true` | ✓ |
| E | Payload da mensagem == JSON do response da API, `delivery_mode=2`, `content_type: application/json` | ✓ |
| F | Blob existe no Azurite com tamanho = 2453760 bytes | ✓ |
| G | Restart da API: container "already exists", queue reassertada | ✓ (idempotente) |
| H | Blob persistiu após restart | ✓ |
| I | `GET /health` segue 200 com tudo ok | ✓ |

## 8. Pendências anotadas para próximas fases

- **Fase 3:** criar `CsvConsumerService` que consome `csv.uploaded`, baixa o blob via `AzuriteService.downloadBlob`, parseia (separator `;`, formato `DD/MM/YYYY HH:MM`) e insere em lote no Postgres.
- **Fase 3:** decidir estratégia de ack — ack só depois da inserção completa? Nack com requeue em caso de falha? Dead letter queue?
- **Melhorias (pra citar no README final):** compensação upload↔publish, streaming upload pra arquivos grandes, rate limit no endpoint de upload.

---

**Status:** ✅ concluída e validada em 2026-04-16.
