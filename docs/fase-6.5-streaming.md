# Fase 6.5 — Streaming ponta a ponta

**Objetivo:** retirar todos os pontos onde o arquivo era materializado em memória. A API precisa processar CSVs de qualquer tamanho com RAM constante.

Motivação: revisão técnica de um teste anterior sinalizou que essa é uma das diferenças entre "funciona" e "funciona bem". O enunciado não pede explicitamente, mas a escolha é visível no código (`csv-parse/sync`, `downloadToBuffer`) e cita performance como critério.

---

## 1. Pontos refatorados

### 1.1 Upload: custom Multer StorageEngine que escreve direto no Azurite

**Antes**
```typescript
// multer memoryStorage: bufferava o arquivo inteiro em file.buffer
@UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50MB } }))
async upload(@UploadedFile() file) {
  await azurite.uploadBlob(name, file.buffer); // Buffer de 30MB, 300MB, etc.
  ...
}
```

**Depois**
```typescript
// AzuriteStorageEngine: _handleFile(req, file, cb) pipa file.stream pro Azurite
// via blobClient.uploadStream (chunks de 4MB x 5 concorrentes)
@UseInterceptors(FileInterceptor('file'))
async upload(@UploadedFile() file) {
  // file.filename ja' e' o blobName, file.size ja' veio do SDK
  await uploads.handleUpload(file); // so' publica mensagem, o upload ja' aconteceu
}
```

O `AzuriteStorageEngine` implementa `multer.StorageEngine`:
- `_handleFile(req, file, cb)` → chama `azurite.uploadFromStream(blobName, file.stream)` e invoca o callback com `{ filename: blobName, size }`
- Registrado via `MulterModule.registerAsync({ inject: [AzuriteService], useFactory: ... })` pra receber DI
- `fileFilter` no factory valida `.csv` **antes** da chamada ao storage → arquivos inválidos não sobem ao blob

### 1.2 Download do Azurite em stream

**Antes** — `downloadToBuffer()` do SDK: materializa o blob todo antes de retornar.
**Depois** — `blobClient.download()` retorna `readableStreamBody` (Node Readable). O SDK lê chunks sob demanda.

### 1.3 CSV parse em async iterator com batches

**Antes** — `csv-parse/sync` carregava todas as linhas em um array antes de inserir.
**Depois** — `csv-parse` (versão streaming) + `for await` acumula 1000 rows e emite, zerando o buffer interno:

```typescript
for await (const batch of parseRowsInBatches(stream, 1000)) {
  await metrics.insertBatch(batch);
}
```

Pico de memória viva: `batchSize × tamanho da row + chunks internos do parser ≈ 100KB-500KB`.

### 1.4 Insert: uma transação por batch, não por arquivo

**Antes** — `insertReadings(rows)` abria 1 transação pro arquivo inteiro e chunkava internamente.
**Depois** — `insertBatch(rows)` é a primitiva: insere 1 batch atomicamente, devolve quantas linhas efetivamente entraram (graças ao `RETURNING id` + `ON CONFLICT DO NOTHING`). A camada de cima (consumer) itera os batches.

Trade-off: se o consumer morrer no meio do arquivo, parte dos dados já está commitada. **Aceitável** porque:
- `UNIQUE (metric_id, date_time)` + `ON CONFLICT DO NOTHING` garante que reprocessar a mensagem (mudando `nack` pra `requeue=true` ou reupload) não duplica nada — só ignora o que já entrou e completa o resto.
- A alternativa (1 transação gigante) manteria transação aberta por minutos em arquivos grandes, o que é ruim pra Postgres (bloat, locks).

---

## 2. Arquivos tocados

```
backend/src/
├── azurite/azurite.service.ts              # uploadFromStream + downloadBlobStream
├── metrics/csv-parser.util.ts              # parseRowsInBatches (async generator)
├── metrics/metrics.repository.ts           # insertBatch em vez de insertReadings
├── consumer/csv-consumer.service.ts        # for await (batch of ...)
├── uploads/azurite-storage.engine.ts       # NOVO: custom multer storage
├── uploads/uploads.module.ts               # MulterModule.registerAsync
├── uploads/uploads.controller.ts           # simplificado
└── uploads/uploads.service.ts              # nao faz mais upload, so' publica msg
backend/package.json                        # + multer@^2.0.0
```

---

## 3. Verificação executada (2026-04-16)

### 3.1 Regressão com o CSV modelo (2.4MB, 93088 linhas)

| Teste | Resultado |
|-------|-----------|
| Upload → consumer → persist | 93088/93088 rows em 94 batches, 6.4s |
| `SELECT COUNT(*)` | 93088 ✓ |
| Metric 218219, 2023-11-21..22 aggregate | `[{DAY:266}, {DAY:96}]` (idêntico ao antes) ✓ |
| Validação `.txt` | 400 Bad Request "apenas .csv aceitos" ✓ |

### 3.2 Stress test: CSV sintético de 31MB, 1.200.000 linhas, 500 métricas

Gerei o arquivo com Python:
```python
for i in range(1_200_000):
    mid = 100000 + (i % 500)
    ts = start + dt.timedelta(minutes=5*(i//500)) + dt.timedelta(minutes=i%5)
    print(f'{mid};{ts.strftime("%d/%m/%Y %H:%M")};{i%2}')
```

Amostrei `docker stats gy-api` a cada 1s durante o processamento:

| Momento | Memoria RSS |
|---------|-------------|
| Baseline (idle) | 288.6 MiB |
| Média durante processamento | 316.1 MiB |
| **Pico** | **341.3 MiB** |
| **Delta vs baseline** | **+52.7 MiB** |

**Interpretação:**
- Sem streaming, um arquivo de 31MB teria carregado:
  - Buffer do download: ~31MB
  - csv-parse/sync com 1.2M objetos: ~120MB
  - Mais arrays de batch, estado interno do pg, etc.
  - Esperado: +200 a +400MB sobre baseline
- Com streaming: **+53MiB total**. A diferença entre 53 e 300+ MB prova que o parser não acumula e o download não buffera.

### 3.3 Funcionalidade preservada

| Teste | Resultado |
|-------|-----------|
| Contagem pós-upload | 1.200.000 rows, 500 metric_ids ✓ |
| Range de datas | 2020-01-01 00:00 a 2020-01-09 07:59 ✓ |
| **Idempotência no grande**: reupload do mesmo arquivo | `Persisted 0/1200000` (todos conflitos) ✓ |
| Count após reupload | 1.200.000 (não cresceu) ✓ |

### 3.4 Performance

- Upload HTTP do 31MB: **437ms** (stream pro Azurite em paralelo com o multipart parser)
- Consumer: **92.5s pro arquivo grande** (1200 batches × ~77ms cada). Um pouco mais lento que a versão "1 transação só" porque cada batch é um commit com fsync. Vale a pena pelo ganho de memória e idempotência granular.

---

## 4. Decisões e trade-offs

### `blobClient.uploadStream` com chunk=4MB, concurrency=5
Os defaults do SDK. O chunk é grande o bastante pra amortizar latência de rede, pequeno o bastante pra não estourar memória. A concorrência permite enviar 5 blocos em paralelo enquanto 5 outros chegam do cliente.

### Multer 2.x em vez de 1.x
Multer 1.x foi marcado como vulnerável (CVEs). Subi a dependência direta pra 2.x — API do `StorageEngine` é compatível.

### `for await` em vez de callbacks `on('data')`
Mais limpo, sem backpressure manual. O `for await` no parser já controla fluxo naturalmente — quando o `await repo.insertBatch(...)` está rodando, o Node não lê mais do stream, dando contra-pressão automática ao Azurite.

### Custom `StorageEngine` em vez de `busboy` raw no controller
Considerei escrever busboy inline no controller (é o que Multer usa por baixo). Mas:
- Multer já resolve edge cases de multipart (múltiplas partes, encoding, limites).
- O padrão `@UseInterceptors(FileInterceptor('file'))` + `@UploadedFile()` permanece o idiomático Nest.
- A complexidade do streaming fica encapsulada em uma classe coesa (~40 linhas).

### Memória "delta" em vez de absoluta
Reporto `+53MiB` sobre baseline em vez de `341MiB total` porque o baseline inclui código base, Nest, TypeORM, cache do Node — nada que escala com o arquivo. O delta é o que importa pra prever comportamento.

---

## 5. Pendências / melhorias anotadas

- **Backpressure explícito no insertBatch**: se o Postgres for mais lento que o parser, o for await já pausa o stream. Mas em caso extremo (DB sobrecarregado), vale adicionar um `max in-flight batches` limit. Não cheguei lá ainda.
- **Streaming do Excel report**: `exceljs` tem `wb.xlsx.write(responseStream)` que serializa direto no response. Hoje a gente ainda constrói um buffer. Pra relatórios enormes (10k+ linhas) vale trocar. Anotado como melhoria no README final.
- **Retry com backoff em falha do DB**: hoje um batch que falha nack-a a mensagem inteira. Com ON CONFLICT idempotente, retry com requeue seria seguro. Anotado.
- **Prefetch do channel AMQP**: sem `channel.prefetch(1)`, o broker pode jogar várias mensagens na mesma conexão. Pra consumo pesado valeria limitar. Não afeta os testes atuais (1 mensagem por vez).

---

**Status:** ✅ concluída e validada em 2026-04-16. Pico de memória **+53 MiB** comprovado em arquivo de 1.2M linhas; regressão e idempotência intactas.
