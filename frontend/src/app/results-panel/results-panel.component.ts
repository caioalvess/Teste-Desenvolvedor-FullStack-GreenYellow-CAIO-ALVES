import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { TableModule } from 'primeng/table';
import { SkeletonModule } from 'primeng/skeleton';
import { MetricsStore } from '../metrics.store';

@Component({
  selector: 'app-results-panel',
  standalone: true,
  imports: [CommonModule, TableModule, SkeletonModule],
  template: `
    <section class="panel" aria-labelledby="results-title">
      <header class="panel-head">
        <div>
          <h2 id="results-title">Resultados</h2>
          <p>
            @if (store.searched() && store.isFormValid()) {
              MetricId {{ store.metricId() }} ·
              {{ formatDate(store.dateInitial()) }} →
              {{ formatDate(store.finalDate()) }} ·
              por {{ granularityLabel() }}
            } @else {
              Preencha os filtros e clique em Consultar.
            }
          </p>
        </div>
        <div class="chips" aria-live="polite">
          <span class="chip">
            <i class="pi pi-chart-line" aria-hidden="true"></i>
            {{ store.loading() ? '—' : store.data().length }}
            {{ store.data().length === 1 ? 'ponto' : 'pontos' }}
          </span>
          <span class="chip muted">
            total: {{ store.loading() ? '—' : (store.total() | number) }}
          </span>
        </div>
      </header>

      <div class="body" aria-live="polite">
        @if (showInitial()) {
          <div class="empty muted">
            <i class="pi pi-sliders-h" aria-hidden="true"></i>
            <p>Os resultados aparecem aqui após a consulta.</p>
          </div>
        } @else if (showEmpty()) {
          <div class="empty">
            <i class="pi pi-inbox" aria-hidden="true"></i>
            <p>Nenhuma leitura encontrada para os critérios informados.</p>
          </div>
        } @else {
          <p-table
            [value]="store.loading() ? skeletonRows : store.data()"
            [styleClass]="'gy-table' + (store.loading() ? ' is-loading' : '')"
            [paginator]="!store.loading() && store.data().length > 8"
            [rows]="8"
            [tableStyle]="{ 'min-width': '320px' }"
          >
            <ng-template pTemplate="header">
              <tr>
                <th scope="col">Data</th>
                <th scope="col" class="right">Valor</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-row>
              @if (store.loading()) {
                <tr aria-hidden="true">
                  <td><p-skeleton width="7rem" height="0.95rem" /></td>
                  <td class="right">
                    <p-skeleton width="4rem" height="0.95rem" styleClass="ml-auto" />
                  </td>
                </tr>
              } @else {
                <tr>
                  <td>{{ row.date }}</td>
                  <td class="right num">{{ row.value | number }}</td>
                </tr>
              }
            </ng-template>
          </p-table>
        }
      </div>
    </section>
  `,
  styles: [
    `
      :host { display: block; height: 100%; }
      .panel {
        background: var(--gy-surface);
        border: 1px solid var(--gy-border);
        border-radius: 14px;
        padding: 1.5rem;
        box-shadow: var(--gy-shadow);
        min-height: 100%;
        display: flex;
        flex-direction: column;
      }
      .panel-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 1rem;
        margin-bottom: 1.25rem;
        flex-wrap: wrap;
      }
      .panel-head h2 {
        font-family: 'Nunito', sans-serif;
        font-size: 1.05rem;
        font-weight: 800;
        margin: 0 0 0.2rem;
      }
      .panel-head p {
        margin: 0;
        font-size: 0.85rem;
        color: var(--gy-text-soft);
      }
      .chips { display: flex; gap: 0.5rem; flex-shrink: 0; }
      .chip {
        display: inline-flex; align-items: center; gap: 0.35rem;
        padding: 0.3rem 0.75rem;
        border-radius: 999px;
        font-size: 0.78rem;
        font-weight: 700;
        background: var(--gy-green-50);
        color: var(--gy-green-dark);
      }
      :root[data-theme='dark'] .chip { color: var(--gy-green); }
      .chip.muted {
        background: var(--gy-surface-2);
        color: var(--gy-text-soft);
      }

      .body {
        flex: 1;
        min-height: 260px;
        overflow: hidden; /* evita scroll durante o transform dos rows */
      }

      .empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        min-height: 260px;
        padding: 2rem 1rem;
        text-align: center;
        background: var(--gy-surface-2);
        border: 1px dashed var(--gy-border);
        border-radius: 12px;
      }
      .empty i {
        font-size: 2.1rem;
        color: var(--gy-green);
        opacity: 0.8;
      }
      .empty.muted i {
        color: var(--gy-text-soft);
        opacity: 0.55;
      }
      .empty p {
        margin: 0;
        font-size: 0.9rem;
        color: var(--gy-text-soft);
        max-width: 32ch;
      }

      .right { text-align: right; }
      .num { font-variant-numeric: tabular-nums; font-weight: 600; }
      :host ::ng-deep .ml-auto { margin-left: auto; display: block; }
    `,
  ],
})
export class ResultsPanelComponent {
  readonly store = inject(MetricsStore);
  readonly skeletonRows = Array.from({ length: 4 });

  readonly showInitial = computed(
    () => !this.store.searched() && !this.store.loading(),
  );
  readonly showEmpty = computed(
    () =>
      this.store.searched() &&
      !this.store.loading() &&
      this.store.data().length === 0,
  );

  granularityLabel(): string {
    switch (this.store.granularity()) {
      case 'DAY': return 'dia';
      case 'MONTH': return 'mês';
      case 'YEAR': return 'ano';
    }
  }

  formatDate(d: Date | null): string {
    if (!d) return '—';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  }
}
