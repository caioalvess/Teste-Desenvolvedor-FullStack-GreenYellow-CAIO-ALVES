# Fase 7.7 — Profile `prod` no docker-compose

**Objetivo:** permitir subir a stack em modo **produção** com um único comando, separado de dev, reusando a mesma infra.

---

## 1. Comandos

```bash
# dev (default, igual antes)
docker compose up -d

# prod (sobe api-prod + frontend-prod + infra, SEM subir dev)
docker compose --profile prod up -d postgres rabbitmq azurite api-prod frontend-prod

# prod simples (se quiser tudo: dev + prod coexistindo — portas distintas)
docker compose --profile prod up -d
```

## 2. O que mudou no compose

Adicionados 2 serviços novos, ambos com `profiles: ["prod"]`:

- `api-prod` → build `target: prod`, `container_name: gy-api-prod`, porta host `3003` (vs `3001` do dev), **sem bind mount** (só o bundle compilado)
- `frontend-prod` → build `target: prod`, `container_name: gy-frontend-prod`, porta host `8080` (vs `4200` do dev), servindo via nginx

Serviços **sem `profiles`** (postgres, rabbitmq, azurite, api, frontend) continuam subindo por padrão. Quem tem profile só sobe com `--profile <nome>`.

## 3. Novas variáveis de env

```ini
API_PROD_PORT=3003
FRONTEND_PROD_PORT=8080
CORS_ORIGIN=http://localhost:8080
```

Default value está no compose com `${VAR:-fallback}`, então funciona mesmo se `.env` não tiver.

## 4. Validação executada (2026-04-17)

```bash
docker compose --profile prod up -d api-prod frontend-prod
```

Resultado:

| # | Teste | Resultado |
|---|-------|-----------|
| 1 | `docker compose config --quiet` (syntax válida) | ✅ |
| 2 | Ambos containers sobem | ✅ 7 containers up (3 infra + 2 dev + 2 prod) |
| 3 | `GET http://localhost:3003/health` | HTTP 200, todos serviços `ok` |
| 4 | `GET http://localhost:8080/` | HTTP 200 (index.html do Angular compilado) |
| 5 | SPA fallback `GET http://localhost:8080/qualquer-rota` | HTTP 200 (serve index.html) |
| 6 | Infra compartilhada (postgres/rabbit/azurite sem duplicação) | ✅ |

## 5. Decisões

### Portas distintas entre dev e prod
Motivo: permite **rodar os dois em paralelo** pra comparar (bom pra smoke test de deploy, pra validação visual, pra fazer A/B rápido). Sem isso, teria conflito de binding.

### `container_name` explícito
Motivo: `docker logs gy-api-prod` e `docker exec gy-api-prod ...` ficam legíveis e estáveis. Sem isso, vira `teste-desenvolvedor_api-prod_1` ou algum hash.

### Sem bind mount no api-prod
Motivo: prod **não** precisa hot reload. Rodar a imagem imutável prova que o artefato compilado funciona sozinho, sem source na máquina.

### Sem `target: prod` override via arquivo separado (ex.: `docker-compose.prod.yml`)
Motivo: a abordagem "dois arquivos + `-f`" fragmenta os comandos e exige que o usuário lembre de passar os dois `-f`. Profile num arquivo só é idiomatic Docker Compose v2 e tem UX simples (`--profile prod`).

### Dev services ficam SEM profile (default)
Motivo: preservar o fluxo de dev atual. Todo mundo que já rodou `docker compose up -d` continua com mesma experiência. `prod` é opt-in explícito.

---

## 6. Ponto de atenção (documentado)

**Não rode dev + prod simultaneamente compartilhando a fila**. Os dois consumers ouvem a mesma `csv.uploaded` e o Rabbit faz round-robin — um upload pode ser processado por dev OU prod aleatoriamente, **não por ambos**. Se quiser validar prod de fato, pare o dev primeiro:

```bash
docker compose stop api frontend
docker compose --profile prod up -d api-prod frontend-prod
```

Em deploy real, o ambiente é um só — o problema não existe.

---

## 7. Próxima fase

**7.8** — README final consolidado: visão geral, arquitetura (diagrama ASCII ou mermaid), como rodar (dev e prod), decisões técnicas (índice pros docs por fase), melhorias futuras, limitações conhecidas.

---

**Status:** ✅ Compose com profile prod funcionando. Sobe, conecta na infra, responde `/health` 200 e serve front estático.
