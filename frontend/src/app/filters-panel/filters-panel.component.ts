import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { CalendarModule } from 'primeng/calendar';
import { SelectButtonModule } from 'primeng/selectbutton';
import { MetricsStore } from '../metrics.store';
import { Granularity } from '../models';
import { DateMaskDirective } from '../date-mask.directive';
import { extractCsvMeta } from '../csv-meta.util';

const GRANULARITY_OPTIONS: Array<{ label: string; value: Granularity }> = [
  { label: 'Dia', value: 'DAY' },
  { label: 'Mês', value: 'MONTH' },
  { label: 'Ano', value: 'YEAR' },
];

@Component({
  selector: 'app-filters-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    InputNumberModule,
    CalendarModule,
    SelectButtonModule,
    DateMaskDirective,
  ],
  template: `
    <section class="panel" aria-labelledby="filters-title">
      <header class="panel-head">
        <h2 id="filters-title">Consulta</h2>
        <p>Envie o CSV e ajuste os filtros para consultar.</p>
      </header>

      <div
        class="drop-zone"
        [class.is-dragging]="isDragging()"
        [class.has-file]="!!store.lastUpload()"
        (dragover)="onDragOver($event)"
        (dragleave)="onDragLeave($event)"
        (drop)="onDrop($event)"
        role="button"
        tabindex="0"
        aria-label="Área de upload do arquivo CSV. Arraste um arquivo aqui ou clique para selecionar."
        (click)="fileInput.click()"
        (keydown.enter)="fileInput.click()"
        (keydown.space)="fileInput.click(); $event.preventDefault()"
      >
        <input
          #fileInput
          type="file"
          accept=".csv"
          hidden
          (change)="onFileSelected($event)"
        />
        @if (store.uploading()) {
          <div class="drop-content">
            <i class="pi pi-spin pi-spinner"></i>
            <strong>Enviando…</strong>
          </div>
        } @else if (store.lastUpload()) {
          <div class="drop-content success">
            <i class="pi pi-check-circle"></i>
            <strong>{{ store.lastUpload()?.originalName }}</strong>
            <small>
              {{ formatBytes(store.lastUpload()?.size ?? 0) }} ·
              clique para substituir
            </small>
          </div>
          <button
            type="button"
            class="clear-btn"
            (click)="onClear($event)"
            (keydown.enter)="$event.stopPropagation()"
            (keydown.space)="$event.stopPropagation()"
            aria-label="Remover arquivo selecionado"
            title="Remover arquivo"
          >
            <i class="pi pi-times" aria-hidden="true"></i>
          </button>
        } @else {
          <div class="drop-content">
            <i class="pi pi-cloud-upload"></i>
            <strong>Arraste um CSV aqui</strong>
            <small>ou clique para selecionar (até 500 MB)</small>
          </div>
        }
      </div>

      <div class="divider"></div>

      <div class="field">
        <label for="metricId">MetricId</label>
        <p-inputNumber
          inputId="metricId"
          [ngModel]="store.metricId()"
          (ngModelChange)="store.metricId.set($event)"
          [useGrouping]="false"
          [min]="0"
          placeholder="ex: 218219"
          aria-required="true"
        />
      </div>

      <div class="field-row">
        <div class="field">
          <label for="dateInitial">De</label>
          <p-calendar
            inputId="dateInitial"
            [ngModel]="store.dateInitial()"
            (ngModelChange)="store.dateInitial.set($event)"
            dateFormat="dd-mm-yy"
            [showIcon]="true"
            iconDisplay="input"
            appendTo="body"
            placeholder="dd-mm-aaaa"
            aria-required="true"
            appDateMask
          />
        </div>
        <div class="field">
          <label for="finalDate">Até</label>
          <p-calendar
            inputId="finalDate"
            [ngModel]="store.finalDate()"
            (ngModelChange)="store.finalDate.set($event)"
            dateFormat="dd-mm-yy"
            [showIcon]="true"
            iconDisplay="input"
            appendTo="body"
            placeholder="dd-mm-aaaa"
            aria-required="true"
            appDateMask
          />
        </div>
      </div>

      <div class="field">
        <label id="granularity-label">Granularidade</label>
        <p-selectButton
          [options]="granularityOptions"
          [ngModel]="store.granularity()"
          (ngModelChange)="store.granularity.set($event)"
          optionLabel="label"
          optionValue="value"
          aria-labelledby="granularity-label"
        />
      </div>

      <div class="actions">
        <p-button
          label="Consultar"
          icon="pi pi-search"
          (onClick)="store.consultar()"
          [loading]="store.loading()"
          [disabled]="!store.isSubmittable()"
          styleClass="w-full"
        />
        <p-button
          label="Baixar Excel"
          icon="pi pi-file-excel"
          severity="success"
          [outlined]="true"
          (onClick)="store.baixarExcel()"
          [disabled]="!store.isSubmittable()"
          styleClass="w-full"
        />
        @if (store.isFormValid() && !store.isSubmittable()) {
          <small class="hint-missing-upload" role="status">
            <i class="pi pi-info-circle" aria-hidden="true"></i>
            Envie um CSV acima para habilitar a consulta.
          </small>
        }
      </div>
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      .panel {
        background: var(--gy-surface);
        border: 1px solid var(--gy-border);
        border-radius: 14px;
        padding: 1.5rem;
        box-shadow: var(--gy-shadow);
      }
      .panel-head h2 {
        font-family: 'Nunito', sans-serif;
        font-size: 1.05rem;
        font-weight: 800;
        margin: 0 0 0.2rem;
      }
      .panel-head p {
        margin: 0 0 1.25rem;
        font-size: 0.85rem;
        color: var(--gy-text-soft);
      }

      .drop-zone {
        position: relative;
        border: 2px dashed var(--gy-border);
        background: var(--gy-surface-2);
        border-radius: 12px;
        padding: 1.25rem 1rem;
        text-align: center;
        cursor: pointer;
        transition: border-color 200ms ease, background-color 200ms ease;
        outline: none;
        min-height: 132px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .clear-btn {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        width: 26px;
        height: 26px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: var(--gy-text-soft);
        display: grid;
        place-items: center;
        cursor: pointer;
        font-size: 0.78rem;
        opacity: 0.55;
        transition: background-color 140ms, color 140ms, opacity 140ms;
      }
      .clear-btn:hover {
        background: rgba(239, 68, 68, 0.1);
        color: #ef4444;
        opacity: 1;
      }
      :root[data-theme='dark'] .clear-btn:hover {
        background: rgba(239, 68, 68, 0.18);
        color: #fca5a5;
      }
      .clear-btn:focus-visible {
        outline: none;
        box-shadow: var(--focus-ring);
        opacity: 1;
      }
      .drop-zone:hover,
      .drop-zone:focus-visible,
      .drop-zone.is-dragging {
        border-color: var(--gy-green);
        background: var(--gy-green-50);
      }
      .drop-zone:focus-visible {
        box-shadow: var(--focus-ring);
      }
      .drop-zone.has-file {
        border-style: solid;
        border-color: var(--gy-green);
        background: var(--gy-green-50);
      }
      .drop-content {
        display: flex; flex-direction: column; align-items: center; gap: 0.25rem;
      }
      .drop-content i {
        font-size: 1.75rem;
        color: var(--gy-green-dark);
        margin-bottom: 0.35rem;
      }
      :root[data-theme='dark'] .drop-content i { color: var(--gy-green); }
      .drop-content strong {
        font-family: 'Nunito', sans-serif;
        font-size: 0.95rem;
        color: var(--gy-text);
      }
      .drop-content small {
        font-size: 0.78rem;
        color: var(--gy-text-soft);
      }
      .drop-content.success strong { color: var(--gy-green-dark); }
      :root[data-theme='dark'] .drop-content.success strong { color: var(--gy-green); }

      .divider { height: 1px; background: var(--gy-border); margin: 1.25rem 0; }

      .field { display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 0.9rem; }
      .field label {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--gy-text-soft);
        font-weight: 700;
      }
      .field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }

      .actions {
        display: flex; flex-direction: column; gap: 0.5rem;
        margin-top: 1.25rem;
      }
      .hint-missing-upload {
        display: inline-flex; align-items: center; gap: 0.4rem;
        margin-top: 0.35rem;
        font-size: 0.78rem;
        color: var(--gy-text-soft);
      }
      .hint-missing-upload i { color: var(--gy-green); }
      :host ::ng-deep .w-full { width: 100%; }
      :host ::ng-deep .w-full .p-button { width: 100%; justify-content: center; }
      :host ::ng-deep .p-inputnumber { width: 100%; }
      :host ::ng-deep .p-inputnumber input { width: 100%; }
      :host ::ng-deep .p-calendar { width: 100%; }
      :host ::ng-deep .p-calendar input { width: 100%; }
      :host ::ng-deep .p-selectbutton { display: flex; }
      :host ::ng-deep .p-selectbutton .p-button { flex: 1; justify-content: center; }
    `,
  ],
})
export class FiltersPanelComponent {
  readonly granularityOptions = GRANULARITY_OPTIONS;
  readonly store = inject(MetricsStore);
  readonly isDragging = signal(false);

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(true);
  }
  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
  }
  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) this.handleFile(file);
  }
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.handleFile(file);
    input.value = '';
  }

  onClear(event: MouseEvent): void {
    event.stopPropagation(); // nao abre o file picker
    this.store.clearUpload();
  }

  private async handleFile(file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      // delega o erro pra mensageria — aqui apenas faz guard
      return;
    }
    // Extrai metadados em paralelo com o upload pra pre-preencher o form
    this.prefillFromFile(file).catch(() => undefined);
    this.store.uploadCsv(file);
  }

  private async prefillFromFile(file: File): Promise<void> {
    const meta = await extractCsvMeta(file);
    if (meta.metricId !== null && meta.firstDate && meta.lastDate) {
      this.store.prefillFromMeta({
        metricId: meta.metricId,
        firstDate: meta.firstDate,
        lastDate: meta.lastDate,
      });
    }
  }

  formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }
}
