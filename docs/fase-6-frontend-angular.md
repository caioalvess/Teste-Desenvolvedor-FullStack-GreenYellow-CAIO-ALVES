# Fase 6 — Frontend Angular + PrimeNG

**Objetivo:** SPA que permite o usuário fazer upload do CSV, visualizar dados agregados e baixar o relatório Excel. Atende item 9 do enunciado.

---

## 1. Stack escolhida

- **Angular 17.3** (standalone components, Signals, nova `@if` / `@for` template syntax)
- **PrimeNG 17.18** (componentes prontos: Toolbar, Card, FileUpload, InputNumber, Calendar, SelectButton, Table, Button, Message)
- **PrimeIcons** (ícones dos botões)
- **tema `lara-light-blue`** do PrimeNG (embutido, zero config extra)
- **Node 20 alpine** no container (builda em ~7s, roda `ng serve` em modo watch)

### Por que Angular 17 e não 18?
- Node 18 no host seria incompatível com Angular 18. 17 é stable, usa todas as features modernas (standalone, signals, novo control flow) e roda tanto em Node 18 quanto em Node 20.
- Menos risco de quebrar versões de PrimeNG (PrimeNG 17 é o LTS estável).

### Por que não tem `@angular/router`?
É uma SPA de tela única com dois cards — upload em cima, dashboard embaixo. Adicionar roteamento seria over-engineering. Os card do PrimeNG já separam visualmente.

---

## 2. Estrutura do app

```
frontend/
├── Dockerfile               # node:20-alpine + ng serve
├── .dockerignore
├── angular.json             # config do Angular CLI (budget bumpado pra PrimeNG)
├── package.json             # deps + scripts start/build/typecheck
├── tsconfig.json
├── tsconfig.app.json
└── src/
    ├── index.html           # titulo + <app-root>
    ├── main.ts              # bootstrapApplication
    ├── styles.scss          # tema PrimeNG + reset global
    └── app/
        ├── app.component.ts         # layout: toolbar + <app-upload> + <app-dashboard>
        ├── app.config.ts            # providers: animations + HttpClient
        ├── api.service.ts           # wrapper HTTP do backend
        ├── models.ts                # types: Granularity, AggregatedPoint, etc.
        ├── upload/
        │   └── upload.component.ts  # FileUpload + feedback (success/error)
        └── dashboard/
            └── dashboard.component.ts  # form + tabela + botao Excel
```

## 3. Decisões

### Standalone components + Signals
O Angular 17 permite componentes sem `NgModule`. Cada componente importa só o que usa. Combinado com `signal()` pra estado reativo, o código fica mais direto e menor que o estilo clássico com `@Input/@Output` + `OnChanges`:

```typescript
readonly data = signal<AggregatedPoint[]>([]);
readonly loading = signal(false);
// template usa: {{ data() }}, @if (loading()) { ... }
```

### `ApiService` centraliza `fetch` na URL do backend
URL base lida de `window.__API_BASE__` (pra eventualmente injetar via env), com default `http://localhost:3001`. Três métodos:
- `uploadCsv(File)` → `POST /uploads` (multipart)
- `aggregate(query)` → `GET /metrics/aggregate`
- `reportUrl(query)` → retorna **URL** (não faz fetch) pra navegação direta no Excel

### Download Excel via `window.location.href`
Em vez de fetch + blob + `URL.createObjectURL()`, só navego pra URL do endpoint. Vantagens:
- O browser respeita `Content-Disposition` e usa o filename vindo do servidor.
- Sem risco de virar o blob inteiro em memória do front.
- 1 linha de código, zero lib.

Desvantagem: navegação completa (flashy na URL). Com SPA, isso é um non-issue — o browser não recarrega a página, só dispara o download.

### `p-fileUpload` no modo `basic` + `customUpload`
O FileUpload do PrimeNG tem modos `basic` (botão simples) e `advanced` (drag-drop com lista de arquivos). Escolhi `basic` por ser menos intrusivo pra um único arquivo. Com `customUpload: true`, eu controlo o envio via nosso `ApiService` (em vez do default do PrimeNG que usaria `XMLHttpRequest` direto).

### `poll 2000` no `ng serve`
Dentro de container com bind-mount, alguns file systems não propagam eventos `inotify` (especialmente em overlay2 + NTFS/9p). O `--poll 2000` força o Angular a verificar mudanças a cada 2s. Custa CPU em idle, mas garante hot-reload funcionar.

### Budget do Angular subido para 1.5MB
PrimeNG + tema Lara dá ~922KB inicial. O default de 500KB warn / 1MB error quebra o build. Bumpei pra 1.5MB warn / 2MB error. Em produção dá pra:
- Tree-shake melhor escolhendo só os estilos dos módulos que uso
- Lazy-loadear trechos da UI
- Usar CDN pro PrimeNG

Pra o escopo do teste, 900KB inicial é aceitável.

### CORS no backend
Habilitei `app.enableCors({ origin: 'http://localhost:4200', ... })` no `main.ts` do Nest. Whitelist estrita (só a origem do front), não `*`. Em produção, leria de env var pra ambientes diferentes.

---

## 4. Fluxo de UX

```
+---------------------------------------------------------------+
| GreenYellow • CSV Metrics                              [logo] |
+---------------------------------------------------------------+

  +--- 1. Upload do CSV ---------------------------------------+
  | [ Selecionar CSV ]                                         |
  |                                                            |
  | ✔ Arquivo enviado: arquivo-modelo.csv (2453760 bytes)     |
  |   Blob: abc-123-arquivo-modelo.csv                         |
  +------------------------------------------------------------+

  +--- 2. Consulta de agregação -------------------------------+
  | MetricId       Data inicial   Data final   Granularidade   |
  | [218219]       [2023-11-21]   [2023-11-22] [Dia|Mês|Ano]   |
  |                                                            |
  | [ 🔍 Consultar ]   [ 📊 Baixar Excel ]                      |
  |                                                            |
  | +------------+---------+                                   |
  | | Data       |  Valor  |                                   |
  | +------------+---------+                                   |
  | | 2023-11-21 |     266 |                                   |
  | | 2023-11-22 |      96 |                                   |
  | +------------+---------+                                   |
  +------------------------------------------------------------+
```

## 5. Como rodar

```bash
cp .env.example .env             # se nao copiou ainda
docker compose up -d              # sobe backend + frontend + infra
```

Abrir no browser:
- Front: http://localhost:4200
- API (pra debug): http://localhost:3001/health
- RabbitMQ UI: http://localhost:15672 (`gy_user` / `gy_password`)

## 6. Verificação executada (2026-04-16)

| # | Teste | Resultado |
|---|-------|-----------|
| 1 | `docker compose build frontend` sem erro | ✅ |
| 2 | Container sobe e `ng serve` compila em 7s, 0 erros | ✅ |
| 3 | `GET http://localhost:4200/` retorna 200 com `<app-root>` e título "GreenYellow • CSV Metrics" | ✅ |
| 4 | `main.js` e `styles.css` servidos com 200 | ✅ |
| 5 | `npm run build` (prod) gera bundle de 923KB | ✅ |
| 6 | **CORS preflight** da API: `OPTIONS /metrics/aggregate` com `Origin: http://localhost:4200` → 204 + headers | ✅ |
| 7 | **E2E simulado** com `curl -H "Origin: http://localhost:4200"`: upload → consumer → aggregate → report Excel | ✅ |

**Limitação:** não tenho browser headless no ambiente, então **não** validei visualmente o render dos componentes PrimeNG. Recomendação: abrir `http://localhost:4200` e seguir o happy path (upload CSV → consultar 2023-11-21 a 2023-11-22 com granularidade DAY → clicar Baixar Excel).

## 7. Decisões de integração

### Hot reload funcionando via `--poll`
Sem o `--poll 2000`, alterações no `src/` dentro do bind mount não são detectadas consistentemente. Com polling, custa ~1% CPU em idle mas funciona em qualquer FS.

### Ambos `backend` e `frontend` no mesmo compose
Um único `docker compose up` sobe **todo** o ambiente (Postgres + Rabbit + Azurite + API + Front). Matches item 10 do enunciado.

### Separação de responsabilidades clara
- `ApiService`: só HTTP
- `UploadComponent`: só upload (e emite evento quando completar)
- `DashboardComponent`: só consulta e download
- `AppComponent`: só layout (toolbar + grid dos cards)

## 8. Pendências / melhorias anotadas

- **Testes de unidade** (Jest ou Jasmine): não escrevi por tempo — menciono na seção de melhorias do README final.
- **E2E com Playwright/Cypress**: seria o teste definitivo do fluxo UI; fica como melhoria.
- **Gráfico** (chart.js/apexcharts) ao lado da tabela: o enunciado não exige, mas seria um plus.
- **Toast/Notification** do PrimeNG ao invés de `<p-message>` — mais moderno, mas mais config. Fica pra melhorias.
- **Variáveis de ambiente do front** (API_BASE vindo de build-time): hoje é hardcoded `localhost:3001`. Em deploy real usaria `@ngx/config` ou similar.
- **Nginx serve estático em produção** vs `ng serve` (dev). Dockerfile hoje é dev-only. Multi-stage build pra prod é melhoria óbvia.

---

**Status:** ✅ concluída e validada em 2026-04-16 (contratos HTTP e build; render visual não verificável neste ambiente).
