import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputNumberModule } from 'primeng/inputnumber';
import { CalendarModule } from 'primeng/calendar';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TableModule } from 'primeng/table';
import { MessageModule } from 'primeng/message';
import { ApiService } from '../api.service';
import { AggregatedPoint, Granularity } from '../models';

const GRANULARITY_OPTIONS: Array<{ label: string; value: Granularity }> = [
  { label: 'Dia', value: 'DAY' },
  { label: 'Mês', value: 'MONTH' },
  { label: 'Ano', value: 'YEAR' },
];

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    InputNumberModule,
    CalendarModule,
    SelectButtonModule,
    TableModule,
    MessageModule,
  ],
  template: `
    <p-card header="2. Consulta de agregação">
      <div class="form-grid">
        <div class="field">
          <label for="metricId">MetricId</label>
          <p-inputNumber
            inputId="metricId"
            [(ngModel)]="metricId"
            [useGrouping]="false"
            [min]="0"
          />
        </div>
        <div class="field">
          <label>Data inicial</label>
          <p-calendar
            [(ngModel)]="dateInitial"
            dateFormat="yy-mm-dd"
            [showIcon]="true"
            appendTo="body"
          />
        </div>
        <div class="field">
          <label>Data final</label>
          <p-calendar
            [(ngModel)]="finalDate"
            dateFormat="yy-mm-dd"
            [showIcon]="true"
            appendTo="body"
          />
        </div>
        <div class="field">
          <label>Granularidade</label>
          <p-selectButton
            [options]="granularityOptions"
            [(ngModel)]="granularity"
            optionLabel="label"
            optionValue="value"
          />
        </div>
      </div>

      <div class="actions">
        <p-button
          label="Consultar"
          icon="pi pi-search"
          (onClick)="consultar()"
          [loading]="loading()"
          [disabled]="!isFormValid()"
        />
        <p-button
          label="Baixar Excel"
          icon="pi pi-file-excel"
          severity="success"
          (onClick)="baixarExcel()"
          [disabled]="!isFormValid()"
        />
      </div>

      @if (error()) {
        <p-message severity="error" [text]="error() ?? ''" styleClass="mt-3" />
      }

      @if (data().length > 0) {
        <p-table
          [value]="data()"
          styleClass="p-datatable-sm mt-3"
          [paginator]="data().length > 15"
          [rows]="15"
        >
          <ng-template pTemplate="header">
            <tr>
              <th>Data</th>
              <th class="right">Valor</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td>{{ row.date }}</td>
              <td class="right">{{ row.value | number }}</td>
            </tr>
          </ng-template>
        </p-table>
      } @else if (searched() && !loading() && !error()) {
        <p-message severity="info" text="Nenhuma leitura neste período." styleClass="mt-3" />
      }
    </p-card>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .form-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 1rem;
        margin-bottom: 1rem;
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .field label {
        font-size: 0.85rem;
        color: var(--text-color-secondary);
      }
      .actions {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
      }
      .mt-3 {
        margin-top: 1rem;
      }
      .right {
        text-align: right;
      }
    `,
  ],
})
export class DashboardComponent {
  readonly granularityOptions = GRANULARITY_OPTIONS;

  metricId: number | null = null;
  dateInitial: Date | null = null;
  finalDate: Date | null = null;
  granularity: Granularity = 'DAY';

  readonly data = signal<AggregatedPoint[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly searched = signal(false);

  constructor(private api: ApiService) {}

  isFormValid(): boolean {
    return (
      this.metricId !== null &&
      this.dateInitial !== null &&
      this.finalDate !== null
    );
  }

  consultar() {
    if (!this.isFormValid()) return;

    this.loading.set(true);
    this.error.set(null);
    this.searched.set(true);

    this.api
      .aggregate({
        metricId: this.metricId!,
        dateInitial: this.toIsoDate(this.dateInitial!),
        finalDate: this.toIsoDate(this.finalDate!),
        granularity: this.granularity,
      })
      .subscribe({
        next: (rows) => {
          this.data.set(rows);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(this.extractError(err));
          this.loading.set(false);
          this.data.set([]);
        },
      });
  }

  baixarExcel() {
    if (!this.isFormValid()) return;
    const url = this.api.reportUrl({
      metricId: this.metricId!,
      dateInitial: this.toIsoDate(this.dateInitial!),
      finalDate: this.toIsoDate(this.finalDate!),
    });
    window.location.href = url;
  }

  private toIsoDate(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private extractError(err: { error?: { message?: string | string[] }; status?: number }): string {
    const msg = err?.error?.message;
    if (Array.isArray(msg)) return msg.join('; ');
    if (typeof msg === 'string') return msg;
    return `Erro na requisição (HTTP ${err?.status ?? '?'})`;
  }
}
