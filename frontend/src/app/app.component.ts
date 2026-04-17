import { Component, computed, inject } from '@angular/core';
import { ToastModule } from 'primeng/toast';
import { FiltersPanelComponent } from './filters-panel/filters-panel.component';
import { ResultsPanelComponent } from './results-panel/results-panel.component';
import { MetricsStore } from './metrics.store';
import { ThemeService } from './theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ToastModule, FiltersPanelComponent, ResultsPanelComponent],
  template: `
    <p-toast position="top-right" />

    <header class="gy-header" role="banner">
      <div class="gy-header-inner">
        <a class="brand" href="/" aria-label="GreenYellow — ir para inicio">
          <img
            src="assets/logo.svg"
            alt="GreenYellow"
            class="brand-logo"
            width="178"
            height="48"
          />
          <span class="brand-divider" aria-hidden="true"></span>
          <span class="brand-sub">Plataforma de Métricas</span>
        </a>

        <div class="header-right">
          <span class="meta" aria-live="polite">
            @if (lastUploadLabel(); as label) {
              <i class="pi pi-check-circle" aria-hidden="true"></i>
              {{ label }}
            }
          </span>
          <button
            type="button"
            class="theme-toggle"
            (click)="theme.toggle()"
            [attr.aria-label]="
              theme.theme() === 'dark'
                ? 'Mudar para tema claro'
                : 'Mudar para tema escuro'
            "
            [attr.title]="
              theme.theme() === 'dark' ? 'Tema claro' : 'Tema escuro'
            "
          >
            <i
              class="pi"
              [class.pi-sun]="theme.theme() === 'dark'"
              [class.pi-moon]="theme.theme() === 'light'"
              aria-hidden="true"
            ></i>
          </button>
        </div>
      </div>
    </header>

    <main id="main" class="container" role="main">
      <div class="split">
        <aside class="left">
          <app-filters-panel />
        </aside>
        <section class="right">
          <app-results-panel />
        </section>
      </div>
    </main>
  `,
  styles: [
    `
      :host { display: block; }
      .gy-header {
        background: var(--gy-surface);
        border-bottom: 1px solid var(--gy-border);
        position: sticky;
        top: 0;
        z-index: 20;
      }
      .gy-header-inner {
        max-width: 1240px;
        margin: 0 auto;
        padding: 0.55rem 1.25rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
      }
      .brand {
        display: inline-flex;
        align-items: center;
        gap: 0.85rem;
        text-decoration: none;
        color: inherit;
      }
      .brand-logo { display: block; height: 48px; width: auto; }
      :root[data-theme='dark'] .brand-logo {
        /* deixa a logo mais legivel no fundo escuro via leve filter */
        filter: brightness(1.15);
      }
      .brand-divider {
        display: inline-block;
        width: 1px;
        height: 30px;
        background: var(--gy-border);
      }
      .brand-sub {
        font-family: 'Nunito Sans', sans-serif;
        font-size: 0.78rem;
        color: var(--gy-text-soft);
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .header-right {
        display: flex;
        align-items: center;
        gap: 0.85rem;
      }
      .meta {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 0.82rem;
        color: var(--gy-text-soft);
      }
      .meta i { color: var(--gy-green); }
      .theme-toggle {
        width: 36px; height: 36px;
        display: grid; place-items: center;
        border-radius: 8px;
        border: 1px solid var(--gy-border);
        background: var(--gy-surface);
        color: var(--gy-text);
        cursor: pointer;
        transition: background 160ms, border-color 160ms, color 160ms;
      }
      .theme-toggle:hover {
        background: var(--gy-green-50);
        border-color: var(--gy-green);
        color: var(--gy-green-dark);
      }
      :root[data-theme='dark'] .theme-toggle:hover { color: var(--gy-green); }

      .container {
        max-width: 1240px;
        margin: 1.5rem auto 3.5rem;
        padding: 0 1.25rem;
      }
      .split {
        display: grid;
        grid-template-columns: 360px 1fr;
        gap: 1.25rem;
        /* align-items: stretch (padrao do grid) faz as duas colunas
           terem a mesma altura — a mais alta dita o tamanho */
      }
      .left,
      .right {
        min-width: 0;
        display: flex;
      }
      .left > *,
      .right > * {
        flex: 1;
        min-width: 0;
      }

      @media (max-width: 900px) {
        .split { grid-template-columns: 1fr; }
        .brand-divider, .brand-sub { display: none; }
        .meta { display: none; }
      }

      @media (max-width: 520px) {
        .header-right { gap: 0.5rem; }
      }
    `,
  ],
})
export class AppComponent {
  readonly store = inject(MetricsStore);
  readonly theme = inject(ThemeService);

  readonly lastUploadLabel = computed(() => {
    const up = this.store.lastUpload();
    if (!up) return null;
    return `último upload: ${up.originalName}`;
  });
}
