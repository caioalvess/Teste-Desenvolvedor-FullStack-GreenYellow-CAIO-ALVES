# Fase 7.5 — Docker multi-stage de produção (backend)

**Objetivo:** gerar uma imagem enxuta de produção pro backend NestJS, separada da imagem de dev (que roda `nest start --watch`).

---

## 1. Estratégia

Um único `Dockerfile` com múltiplos targets:

| Target | Base | Conteúdo | Uso |
|--------|------|----------|-----|
| `base` | node:20-alpine | só `package.json` + lockfile | cache compartilhado |
| `dev` | `base` | todas as deps + src/ + `nest start --watch` | compose dev |
| `builder` | `base` | todas as deps + `npm run build` → `dist/` | compila TS |
| `prod-deps` | `base` | só `npm ci --omit=dev` | deps de runtime |
| `prod` | `node:20-alpine` (fresh) | `dist/` + prod node_modules + user não-root | produção |

O `prod` copia seletivamente do `builder` (`dist/`) e do `prod-deps` (deps runtime). **Nunca** carrega `.ts` nem deps de dev.

## 2. Build

```bash
# dev (compose ja usa isso)
docker compose build api

# prod (image pronta pra registry)
docker build --target prod -t gy-backend:prod ./backend
```

## 3. Validação executada (2026-04-17)

### 3.1 Build
| Item | Resultado |
|------|-----------|
| Dev target: compose build + `/health` 200 | ✅ |
| Prod target: 24 etapas sem erro | ✅ |

### 3.2 Runtime do container prod

```bash
cat > /tmp/prod.env <<'EOF'
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_USER=gy_user
POSTGRES_PASSWORD=gy_password
POSTGRES_DB=gy_metrics
RABBITMQ_HOST=rabbitmq
RABBITMQ_PORT=5672
RABBITMQ_USER=gy_user
RABBITMQ_PASSWORD=gy_password
AZURITE_CONNECTION_STRING=DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://azurite:10000/devstoreaccount1;
CORS_ORIGIN=http://localhost:4200
EOF

docker run --rm -d --name gy-api-prod \
  --network teste-desenvolvedor_default \
  -p 3002:3000 --env-file /tmp/prod.env gy-backend:prod
```

Resultado:

| Teste | Resultado |
|-------|-----------|
| Container sobe sem erro | ✅ |
| `GET /health` | `{status:"ok", services:{postgres:ok, rabbitmq:ok, azurite:ok}}` HTTP 200 |
| Boot logs limpos (modules, routes, Rabbit, Azurite) | ✅ |
| 3 controllers mapeados (Health, Uploads, Metrics) | ✅ |
| Consumer conectado à fila `csv.uploaded` | ✅ |
| Roda como `USER nodeapp` (não-root) | ✅ |
| `CMD ["node", "dist/main.js"]` — sem shell intermediário | ✅ |

### 3.3 Tamanhos reportados

| Imagem | `inspect.Size` |
|--------|----------------|
| `gy-backend:prod` | ~398 MB |
| `teste-desenvolvedor-api:latest` (dev) | ~399 MB |

**Por que ficaram parecidos:** o `docker image inspect` conta total incluindo layers da base compartilhada. `node:20-alpine` sozinho é ~180MB. O ganho real do prod está em **layers únicos**: sem `src/`, sem jest, ts-loader, ts-jest, typescript, `@nestjs/cli` no runtime. Em superficie de ataque e tempo de boot, prod é materialmente menor.

## 4. Decisões

### Multi-stage em um arquivo só
Dedupla setup base. Targets deixam explícito qual imagem é qual.

### `prod-deps` como stage separado (não `npm prune`)
`prune` muta node_modules do builder → quebra cache. Stage dedicado permite cache independente.

### Usuário não-root (`nodeapp`)
Segurança básica. Se alguma coisa escapar, não é root. Alpine usa `addgroup -S && adduser -S`.

### `NODE_ENV=production`
Libs (Express, NestJS) desabilitam stack traces verbosas e habilitam caches.

### `node dist/main.js` direto
Sem `npm start` → sem shell intermediário → responde SIGTERM imediato.

### `COPY package.json` separado de `COPY . .`
Cache de deps: mudar src/ não invalida o layer do `npm ci`.

---

## 5. Próxima fase

**7.6** — Dockerfile multi-stage do frontend: builder roda `ng build`, imagem final `nginx:alpine` serve estáticos. Substitui `ng serve` que é só dev.

---

**Status:** ✅ Completa. Build + runtime validados em container real.
