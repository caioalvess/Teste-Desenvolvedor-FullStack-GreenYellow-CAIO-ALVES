# Fase 7.6 — Docker multi-stage de produção (frontend)

**Objetivo:** servir o Angular compilado via nginx, substituindo o `ng serve` (dev-only) por uma imagem pequena e adequada a produção.

---

## 1. Estratégia

Dockerfile multi-stage com 3 targets:

| Target | Base | Conteúdo | Uso |
|--------|------|----------|-----|
| `dev` | node:20-alpine | todas as deps + src/ + `ng serve` | compose dev (hot reload) |
| `builder` | node:20-alpine | deps + `ng build` → `dist/frontend/browser` | compila bundle |
| `prod` | **nginx:alpine** | só os estáticos compilados + `nginx.conf` | produção |

## 2. Arquivos

```
frontend/Dockerfile         # multi-stage (17 steps)
frontend/nginx.conf         # config customizada: SPA fallback, gzip, cache
docker-compose.yml          # frontend service usa target: dev explicito
```

## 3. `nginx.conf`

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;

    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    # Cache longo para assets com hash no nome (main-XXXX.js, etc.)
    location ~* \.(?:css|js|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # SPA fallback: Angular router cuida de rotas client-side
    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache";
    }
}
```

## 4. Build

```bash
# dev (ng serve) — compose ja usa target: dev
docker compose build frontend

# prod (nginx + estaticos)
docker build --target prod -t gy-frontend:prod ./frontend
```

## 5. Validação executada (2026-04-17)

Rodado:
```bash
docker run --rm -d --name gy-front-prod \
  --network teste-desenvolvedor_default \
  -p 8080:80 gy-frontend:prod
```

Resultado:

| # | Teste | Resultado |
|---|-------|-----------|
| 1 | `GET /` retorna `<!doctype html>` com título "GreenYellow • CSV Metrics" | ✅ HTTP 200 |
| 2 | Assets hashed referenciados (`main-3QQS4EBA.js`, `styles-EVOMEBHD.css`) | ✅ |
| 3 | **SPA fallback**: `GET /alguma-rota-inexistente` → serve index.html | ✅ HTTP 200 |
| 4 | **Gzip ativo**: resposta comprimida (~2KB vs ~15KB não comprimido) | ✅ |
| 5 | Roda sem privilégios elevados (nginx:alpine padrão) | ✅ |

## 6. Tamanho

| Imagem | Tamanho |
|--------|---------|
| `gy-frontend:prod` | **64.6 MB** |
| `teste-desenvolvedor-frontend:latest` (dev) | 853 MB |

**13× menor em prod.** Motivo: dev carrega Angular CLI, ts-loader, esbuild, node_modules completo (~700MB). Prod só carrega `nginx:alpine` (~40MB) + artefatos estáticos (~15MB de JS/CSS/fonts).

Em redes lentas isso é diferença de **minutos** no pull da imagem entre ambientes.

## 7. Decisões

### Multi-stage em arquivo único
Mesma lógica do backend (fase 7.5): base compartilhada, targets deixam explícito qual imagem é qual. `docker build --target dev` pra dev, `--target prod` pra produção.

### `nginx:alpine` em vez de `http-server`/`serve`
Nginx é industrial-grade:
- Gzip on-the-fly
- Cache headers corretos com matching por extensão
- Try_files pra SPA fallback (essencial pro Angular router)
- Tratamento de sinais (SIGTERM) adequado
- Zero deps Node no runtime — superfície mínima

Alternativas como `http-server` ou `serve` do npm seriam ~200MB maiores e sem features de produção.

### Cache `immutable` para hashed assets
Angular (esbuild) gera `main-HASH.js` com hash do conteúdo. Hash muda quando o código muda. Então o cliente pode cachear **pra sempre** (`max-age=31536000, immutable`). Em deploy novo, o HTML aponta pra `main-NOVOHASH.js`, e o browser baixa só o que mudou.

### Cache `no-cache` para o HTML
`index.html` referencia os hashed assets. Se cachear, o usuário pode ficar preso num deploy antigo. `no-cache` força revalidação a cada request, mas o ETag do nginx evita re-download desnecessário quando não mudou.

### SPA fallback via `try_files`
O Angular roteia client-side: `/dashboard`, `/config`, etc. não existem como arquivo. Sem fallback, o browser recarregaria numa rota profunda e daria 404. `try_files $uri $uri/ /index.html` entrega o index, e o Angular router lê a URL e renderiza a tela correta.

### `npm ci` condicional (fallback `npm install`)
Frontend não tem `package-lock.json` commitado ainda. Usei o mesmo padrão do dev — `if [ -f package-lock.json ]; then npm ci; else npm install; fi` — pra não quebrar o build. Em CI/prod real, o lockfile seria versionado e só `npm ci` rodaria, garantindo install determinístico.

### `COPY dist/frontend/browser` (não `dist/frontend`)
Angular 17+ com esbuild coloca os artefatos em `dist/<project>/browser/` (e `dist/<project>/server/` se tivesse SSR). Eu não uso SSR. O nginx serve só o `browser/`.

---

## 8. Próxima fase

**7.7** — Profile `prod` no `docker-compose.yml`. Algo como:
```bash
docker compose --profile prod up
```
sobe os 3 serviços de infra + api-prod + frontend-prod (usando os targets prod), sem afetar o fluxo de dev.

---

**Status:** ✅ Build + runtime validados. 13× menor que dev, SPA fallback funcionando, gzip e cache configurados.
