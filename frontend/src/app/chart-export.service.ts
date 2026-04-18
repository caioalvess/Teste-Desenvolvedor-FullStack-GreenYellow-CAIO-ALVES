import { Injectable, signal } from '@angular/core';

/**
 * Coordena o download dos PNGs dos graficos entre componentes.
 *
 * O problema: o botao "Baixar PNGs" vive na sidebar (FiltersPanel) mas
 * os canvases estao no ResultsPanel. Em vez de passar refs via @ViewChild
 * ou EventEmitter por prop, o ResultsPanel registra uma funcao de export
 * aqui no init e a sidebar dispara via `exportAll()`.
 *
 * Tambem expoe um signal `hasCharts` pra a UI desabilitar o botao quando
 * nao ha charts no DOM (view === 'table' ou data vazio).
 */
@Injectable({ providedIn: 'root' })
export class ChartExportService {
  readonly hasCharts = signal(false);
  private exporter: (() => void) | null = null;

  register(fn: () => void): void {
    this.exporter = fn;
    this.hasCharts.set(true);
  }

  unregister(): void {
    this.exporter = null;
    this.hasCharts.set(false);
  }

  exportAll(): void {
    this.exporter?.();
  }
}
