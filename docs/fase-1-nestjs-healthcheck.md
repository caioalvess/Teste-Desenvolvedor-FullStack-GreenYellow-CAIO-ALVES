# Fase 1 — Scaffold NestJS + Healthcheck

**Objetivo:** subir uma API NestJS mínima que expõe `GET /health` e valida que consegue conectar nos 3 serviços externos (Postgres, RabbitMQ, Azurite) antes de começar a escrever a lógica de negócio.

---

## 1. Estrutura criada

```
backend/
├── Dockerfile               # imagem da API
├── .dockerignore
├── nest-cli.json            # config do NestJS CLI
├── package.json             # dependencias e scripts
├── tsconfig.json            # config TypeScript (strict mode)
├── tsconfig.build.json
└── src/
    ├── main.ts              # bootstrap do NestJS
    ├── app.module.ts        # modulo raiz, carrega ConfigModule + HealthModule
    └── health/
        ├── health.module.ts
        ├── health.controller.ts       # GET /health
        └── checks/
            ├── postgres.check.ts      # SELECT 1
            ├── rabbitmq.check.ts      # amqp.connect
            └── azurite.check.ts       # BlobServiceClient.getProperties
```

## 2. Decisões de arquitetura

### Scaffold manual ao invés de `nest new`
Optei por escrever os arquivos na mão ao invés de usar o CLI oficial. Os dois produzem resultados parecidos, mas o manual:
- tem **exatamente** o que precisa (sem `app.service.ts`/`app.controller.ts` de exemplo que seriam removidos depois);
- deixa o `package.json` enxuto, sem deps de teste que ainda não vamos usar (Jest etc vêm na Fase 7).

### Healthcheck sem `@nestjs/terminus`
O `@nestjs/terminus` é o pacote oficial de health do NestJS. Preferi implementar os 3 checks como providers Injectable simples porque:
- os custom indicators do Terminus pra Rabbit/Azurite dariam o mesmo trabalho que escrever do zero;
- mantém o código direto, sem camada extra de abstração;
- se precisarmos escalar (múltiplos formatos de saída, caching de resultados), migrar pra Terminus depois é trivial.

### Postgres via `pg` puro, não TypeORM
A Fase 3 vai adicionar TypeORM pra modelar a tabela de leituras. Pro healthcheck, abrir uma conexão `pg.Client` e rodar `SELECT 1` é mais simples e não acopla o health a um ORM ainda não configurado.

### `amqplib` direto, não `@nestjs/microservices`
O `@nestjs/microservices` traz o padrão transport (request/reply, event pattern), que é ótimo pra RPC entre microsserviços. Mas aqui o Rabbit é usado como **fila de trabalho** (produtor/consumidor simples, item 1 e 2 do enunciado). `amqplib` direto dá o controle certo e menos indireção.

### `AZURITE_CONNECTION_STRING` completa via env
A alternativa seria `UseDevelopmentStorage=true`, que o SDK aceita mas aponta pra `127.0.0.1:10000` — não funciona de dentro de outro container. A connection string completa nomeia o host `azurite` (nome do service na rede do compose) e fica inteiramente configurável.

### `depends_on` com `condition: service_healthy`
A API só sobe depois que Postgres e Rabbit estão `healthy`. Sem isso, o healthcheck poderia rodar enquanto o Postgres ainda está abrindo, retornando `down` espúrio. Azurite fica em `service_started` porque não tem healthcheck configurado (API do emulador sobe em <1s).

### Bind mount + volume nomeado para `node_modules`
No compose:
```yaml
volumes:
  - ./backend:/app              # hot reload do codigo
  - backend_node_modules:/app/node_modules
```
O bind mount sincroniza o código da máquina com o container (o `nest start --watch` percebe e recompila). O volume nomeado em `/app/node_modules` protege as deps instaladas na build do Docker de serem sobrescritas pelo `node_modules` do host (que pode estar em versão diferente ou nem existir).

---

## 3. Endpoint `GET /health`

Formato de resposta:

**Sucesso (HTTP 200):**
```json
{
  "status": "ok",
  "services": {
    "postgres": { "status": "ok" },
    "rabbitmq": { "status": "ok" },
    "azurite":  { "status": "ok" }
  }
}
```

**Falha (HTTP 503):** algum serviço retorna `{ "status": "down", "detail": "..." }`, e o `status` geral fica `down`. Útil pra readiness probe em Kubernetes/orquestrador real.

Checks rodam em **paralelo** (`Promise.all`) — o tempo total é o max dos 3, não a soma.

## 4. Como a API conecta

Dentro do Docker Compose, a API e os outros serviços estão na mesma rede. Conectam por nome de service:

| Serviço | Host | Porta interna |
|---------|------|----------------|
| Postgres | `postgres` | 5432 |
| RabbitMQ | `rabbitmq` | 5672 |
| Azurite | `azurite` | 10000 |

Essas portas internas **não** são as do host — quem define isso é a seção `ports:` do compose (host:container). É por isso que `POSTGRES_PORT=5432` no env da API funciona mesmo se alguém mudou a porta externa pra 5433 no `.env`.

## 5. Como rodar

```bash
# se ainda nao rodou a Fase 0
cp .env.example .env

# build da imagem da API (so da primeira vez ou quando o Dockerfile/package.json mudar)
docker compose build api

# subir tudo
docker compose up -d

# testar
curl http://localhost:3001/health
```

Porta 3001 no host porque a 3000 já tava ocupada na minha máquina. Se na sua estiver livre, muda `API_PORT=3000` no `.env`.

## 6. Hot reload

O container roda `npm run start:dev`, que usa `nest start --watch`. Qualquer arquivo `.ts` salvo em `backend/src/` é detectado e o servidor reinicia automaticamente. Sem rebuild de Docker necessário pra mudanças de código.

Rebuild do Docker só quando:
- mudar `package.json` / `package-lock.json` (deps novas)
- mudar o `Dockerfile`

## 7. Verificação

```bash
curl -s -w "\nHTTP %{http_code}\n" http://localhost:3001/health
```

Resposta esperada:
```
{"status":"ok","services":{"postgres":{"status":"ok"},"rabbitmq":{"status":"ok"},"azurite":{"status":"ok"}}}
HTTP 200
```

Pra forçar um `down` e ver o outro caminho funcionar:
```bash
docker compose stop rabbitmq
curl -s -w "\nHTTP %{http_code}\n" http://localhost:3001/health
# Esperado: rabbitmq.status "down" com detail, HTTP 503
docker compose start rabbitmq
```

## 8. Pendências anotadas para próximas fases

- Na Fase 2 (upload), vamos precisar criar o **container de blobs** (ex.: `csv-uploads`) no Azurite na inicialização da API — o emulador não cria automaticamente.
- Também vamos declarar a **fila** no Rabbit (`assertQueue`, idempotente). Fica num serviço de bootstrap que vai evoluir.
- O Postgres ainda não tem schema — isso entra na Fase 3 junto com TypeORM e a entidade de leituras.

---

**Status:** ✅ concluída e validada em 2026-04-16.
