# Fase 0 — Infra externa no Docker

**Objetivo:** subir Postgres, RabbitMQ e Azurite em containers locais, parametrizados por `.env`, prontos pra API NestJS consumir nas próximas fases.

---

## 1. Serviços escolhidos e por quê

### Postgres 16 (alpine)
- **Por quê Postgres:** exigido pelo enunciado (item 4).
- **Por quê 16:** versão estável mais recente, suporta `date_trunc`, `generate_series`, janelas — tudo que vamos precisar nas agregações DAY/MONTH/YEAR em SQL puro (item 5 e 7).
- **Por quê alpine:** imagem ~80MB vs ~400MB da imagem default. Menos download, menos superfície.

### RabbitMQ 3 (management-alpine)
- **Por quê Rabbit:** exigido pelo enunciado (itens 1 e 2).
- **Por quê `-management`:** traz a UI web em `http://localhost:15672`. Útil pra debugar a fila manualmente (ver mensagens presas, reinjetar, conferir binding).
- **Por quê alpine:** mesmo motivo do Postgres.

### Azurite (latest, oficial Microsoft)
- **Por quê Azurite:** emulador oficial do Azure Storage, permitido pelo enunciado como alternativa ao Azure real ("azure/azurite"). Sem custo, sem credencial de nuvem, reprodutível.
- **Flags `--loose --skipApiVersionCheck`:** relaxam validações estritas do Azure Storage — padrão em dev com SDK novo contra emulador.
- **Credenciais:** o Azurite usa uma conta fixa e pública (`devstoreaccount1`). É o comportamento documentado pela Microsoft; não é segredo vazado.

---

## 2. Decisões de configuração

| Decisão | Alternativa | Por que escolhi esta |
|---------|-------------|----------------------|
| Healthcheck no Postgres (`pg_isready`) e Rabbit (`rabbitmq-diagnostics ping`) | Só `depends_on: [service]` | `depends_on: service_started` só espera o processo subir, não garante que está pronto. `service_healthy` sim. A API NestJS na Fase 1 usa isso. |
| Volumes nomeados (`postgres_data`, etc.) | Bind mount (`./data:/var/lib/...`) | Volumes nomeados são gerenciados pelo Docker, não poluem o repo, e funcionam igual em qualquer host. |
| Portas via `.env` com default (`${POSTGRES_PORT:-5432}`) | Hardcoded `5432:5432` | Se o dev tem outro Postgres local na 5432 quebra; com `.env` ele troca só `POSTGRES_PORT=5433`. |
| `.env.example` versionado + `.env` ignorado | Só `.env` versionado | Boa prática: template no repo, valores reais fora. Embora neste caso sejam credenciais de dev, manter o padrão já deixa o projeto pronto pra prod. |
| Azurite sem healthcheck | Healthcheck custom | A imagem oficial do Azurite não vem com `curl`/`wget`, e ele sobe em <1s. Custo-benefício não compensa. |

---

## 3. Arquivos criados

```
docker-compose.yml    # definicao dos 3 servicos, volumes, healthchecks
.env.example          # template de variaveis (portas + credenciais)
.env                  # copia local, fora do git
.gitignore            # ignora node_modules, dist, .env, etc
README.md             # visao geral, como rodar, proximas fases
docs/fase-0-infra-docker.md  # este documento
```

---

## 4. Como rodar

```bash
cp .env.example .env
docker compose up -d
docker compose ps
```

Esperado: 3 containers `Up`, Postgres e Rabbit marcados `healthy` em ~10-15s.

## 5. Verificação (smoke tests)

Testes que rodei pra confirmar que tá tudo no ar:

```bash
# Postgres aceita conexão e responde SQL
docker exec gy-postgres pg_isready -U gy_user -d gy_metrics
docker exec gy-postgres psql -U gy_user -d gy_metrics -c "SELECT version();"
# Esperado: accepting connections, PostgreSQL 16.x

# RabbitMQ API de management responde autenticado
curl -s -u gy_user:gy_password http://localhost:15672/api/overview
# Esperado: JSON com management_version, rates_mode, etc

# Azurite responde (sem auth retorna AuthorizationFailure, mas isso prova que o servico ta escutando)
curl -s http://localhost:10000/devstoreaccount1?comp=list
# Esperado: XML com <Code>AuthorizationFailure</Code>
```

## 6. Portas expostas

| Serviço | Porta | Uso |
|---------|-------|-----|
| Postgres | 5432 | Conexão SQL da aplicação |
| RabbitMQ | 5672 | AMQP (fila) |
| RabbitMQ | 15672 | UI management — `http://localhost:15672` |
| Azurite | 10000 | Blob Service (usaremos este) |
| Azurite | 10001 | Queue Service (não usaremos — temos Rabbit) |
| Azurite | 10002 | Table Service (não usaremos) |

## 7. Comandos úteis

```bash
docker compose logs -f postgres    # acompanhar log de um servico
docker compose restart rabbitmq    # reiniciar sem derrubar os outros
docker compose down                # parar mantendo dados
docker compose down -v             # parar e apagar volumes (reset total)
```

## 8. Pendências / pontos de atenção para próximas fases

- Na Fase 1 (NestJS) vamos adicionar o service `api` ao `docker-compose.yml` com `depends_on` usando `condition: service_healthy` pros dois serviços com healthcheck.
- Vamos precisar criar o container do blob (bucket no Azure, chamado "container" no SDK) na inicialização da API — o Azurite não cria automaticamente.
- A fila do RabbitMQ também precisa ser declarada pela aplicação (idempotente via `assertQueue`).
- Index no Postgres (`(metric_id, date_time)`) só faz sentido criar na Fase 3 quando tivermos a tabela, mas já fica anotado.

---

**Status:** ✅ concluída e validada em 2026-04-16.
