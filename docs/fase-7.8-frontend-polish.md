# Fase 7.8 — Frontend redesign & polimento

Iteração sobre o front da Fase 6. Reorganizado pra aplicar identidade visual GreenYellow, UX mais cuidada e acessibilidade.

---

## 1. Decisões visuais

| Item | Escolha |
|------|---------|
| **Paleta** | Verde primário `#87BC25`, verde CTAs `#266400` (contraste AAA com branco), amarelo `#FCCC1D` como acento, texto grafite `#414856`, fundo `#F7F7F7` |
| **Tipografia** | Nunito (títulos, 700/800) + Nunito Sans (corpo, 400/600/700) — Google Fonts |
| **Border radius** | 14px (cards), 10px (painel), 8px (inputs e botões), 999px (chips) |
| **Dark mode** | Paleta dedicada, verde reforçado pra accent `#A4D330`, surfaces `#0F1419`/`#1A1F2A`/`#2D3442`, texto `#E5E7EB`; alterna via `[data-theme="dark"]` no `<html>` |

## 2. Layout escolhido: Split

Header sticky com logo oficial + toggle de tema. Abaixo, grid `360px 1fr`:

- **Esquerda (sticky)** — Upload (drop zone) + form + ações
- **Direita** — Painel de resultados (chips + tabela + estados vazios)

Em telas menores que 900px o grid colapsa pra coluna única.

## 3. Arquitetura Angular

```
frontend/src/app/
├── app.component.ts              # header + split grid + toast
├── app.config.ts                 # providers (MessageService, HttpClient, animations)
├── theme.service.ts              # signal + localStorage + prefers-color-scheme
├── metrics.store.ts              # store centralizado (signals do form, data, loading)
├── api.service.ts                # HTTP
├── models.ts                     # types compartilhados
├── csv-meta.util.ts              # parseia head+tail do CSV pra pre-preencher o form
├── date-mask.directive.ts        # mascara DD-MM-AAAA no p-calendar
├── filters-panel/                # painel ESQUERDO
└── results-panel/                # painel DIREITO
```

### `MetricsStore` (signals)

Estado da aplicação centralizado em um service `@Injectable({ providedIn: 'root' })`:

- **Form**: `metricId`, `dateInitial`, `finalDate`, `granularity` (signals gravaveis)
- **Upload feedback**: `lastUpload`, `uploading`
- **Results**: `data`, `loading`, `searched`
- **Derived**: `total`, `isFormValid` (computed signals)
- **Actions**: `consultar()`, `baixarExcel()`, `uploadCsv(file)`, `prefillFromMeta(meta)`

Os dois painéis consomem o store via `inject(MetricsStore)`. Zero prop-drilling.

### `ThemeService`

`signal<'light' | 'dark'>` com 3 fontes de verdade em ordem de prioridade:
1. localStorage (se o user já escolheu)
2. `prefers-color-scheme` (OS)
3. default `light`

Escrita: `effect(() => document.documentElement.setAttribute('data-theme', theme()))` — sincroniza DOM + persiste em localStorage automaticamente.

## 4. Acessibilidade

| Recurso | Implementação |
|---------|---------------|
| Landmarks | `<header role="banner">`, `<main role="main">`, `<section>` com `aria-labelledby` |
| Labels associadas | Todos os `<input>` têm `<label for="id">` |
| ARIA em drop zone | `role="button"`, `tabindex="0"`, `aria-label`, handlers keydown (Enter/Space) |
| ARIA live | Chips e corpo de resultados anunciam mudanças (`aria-live="polite"`) |
| ARIA em ícones | `aria-hidden="true"` nos decorativos; `aria-label` nos acionáveis |
| Focus visible | Box-shadow verde 3px em qualquer elemento focado |
| Contraste | Verde escuro + branco = 7:1 (AAA); grafite + branco = 12:1 (AAA) |
| Reduced motion | `@media (prefers-reduced-motion: reduce)` zera animações |

## 5. UX polida

### Drop zone real
Borda tracejada, estado "dragging" (verde), estado "com arquivo" (borda sólida verde + checkmark), acessível por teclado, click e drag & drop funcionando.

### Auto-fill do form
Ao selecionar o CSV, o browser lê os primeiros/últimos 64KB via `FileReader + Blob.slice`, extrai `metricId` inicial + primeira/última data, e preenche o form **antes** do upload terminar. Zero custo pro backend.

### Skeleton estável + efeito de carregamento
- Durante loading: a mesma estrutura de `<p-table>` permanece, apenas as rows viram `<p-skeleton>` (shimmer verde translúcido). **Zero flicker** nas consultas subsequentes.
- Barra verde de 2px flui no topo da tabela enquanto carrega (`is-loading` class + pseudo-element animado).
- Quando dados aparecem: **stagger fade-in** — rows emergem em cascata com 35ms de delay entre cada (opacidade 0→1 + translateY 6px→0).

### Máscara nos inputs de data
Directive `appDateMask` ouve o `input` em capture phase, formata digitos `DDMMAAAA → DD-MM-AAAA`, e o parser interno do p-calendar consome o valor já mascarado. `inputmode="numeric"` + `maxlength="10"`.

### Toast em vez de mensagens inline
`MessageService` do PrimeNG. Sucesso no upload, erro na consulta, info no download. Auto-dismiss, animação suave, respeitando a paleta da marca.

### Regra de habilitação dos botões

Computed `isSubmittable` no store controla quando "Consultar" / "Baixar Excel" ficam ativos:

```typescript
isSubmittable = computed(() => {
  if (!isFormValid()) return false;              // 3 campos preenchidos
  if (metricId() === 999) return true;           // demo seedado, libera
  return lastUpload() !== null;                  // normal: exige CSV
});
```

Quando os 3 campos estão preenchidos mas falta o CSV (e não é o metric 999), uma **hint inline** é exibida abaixo dos botões: _"Envie um CSV acima para habilitar a consulta"_.

O seed que alimenta o metric 999 está em `db/seed-demo.sql` — ver README seção 5.1.

## 6. Verificação (2026-04-17)

| Item | Resultado |
|------|-----------|
| Build prod (`ng build`) — sem erros | ✅ |
| Typecheck (`tsc --noEmit`) — sem erros | ✅ |
| Todas as rotas do dev server (`/`, `/assets/*`) servem 200 | ✅ |
| CORS preflight entre `:4200` e `:3001` | ✅ |
| Upload → consumer → aggregate → report (real browser test feito pelo usuário) | ✅ |
| Dark mode alterna, persiste, respeita `prefers-color-scheme` | ✅ |
| Auto-fill funciona com o CSV modelo | ✅ |
| Pipeline completo end-to-end via UI | ✅ |

## 7. Estilo geral

Base PrimeNG `lara-light-blue` sobrescrita via CSS custom properties. Aspectos centrais:

- **Gap e cantos nos `p-selectButton`** — segmentos separados com 0.35rem de gap e cantos arredondados individuais (não grudados)
- **Calendário com `iconDisplay="input"`** — ícone dentro do campo, sem botão azul ao lado
- **Tabela** — header em verde-50 + texto verde escuro, bordas sutis, hover com surface-2
- **Scrollbar customizada** — 10px, arredondada, cor da borda do tema

---

**Status:** ✅ Front polido, dark mode completo, acessibilidade verificada, zero warnings de build.
