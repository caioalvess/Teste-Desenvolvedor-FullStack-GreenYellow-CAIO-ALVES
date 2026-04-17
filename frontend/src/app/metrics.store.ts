import { Injectable, computed, inject, signal } from '@angular/core';
import { MessageService } from 'primeng/api';
import { ApiService } from './api.service';
import { AggregatedPoint, Granularity } from './models';

export interface UploadedFileMeta {
  originalName: string;
  size: number;
  uploadedAt: string;
}

/**
 * Store centralizado dos estados que FiltersPanel (escrita) e
 * ResultsPanel (leitura) compartilham.
 *
 * Campos do form sao signals escrevíveis (ngModel bindings viram set()).
 * Estado derivado (total, isValid) sao computed signals.
 */
@Injectable({ providedIn: 'root' })
export class MetricsStore {
  // Form state
  readonly metricId = signal<number | null>(null);
  readonly dateInitial = signal<Date | null>(null);
  readonly finalDate = signal<Date | null>(null);
  readonly granularity = signal<Granularity>('DAY');

  // Upload feedback
  readonly lastUpload = signal<UploadedFileMeta | null>(null);
  readonly uploading = signal(false);

  // Results state
  readonly data = signal<AggregatedPoint[]>([]);
  readonly loading = signal(false);
  readonly searched = signal(false);

  // Derived
  readonly total = computed(() =>
    this.data().reduce((acc, r) => acc + (r.value ?? 0), 0),
  );
  readonly isFormValid = computed(
    () =>
      this.metricId() !== null &&
      this.dateInitial() !== null &&
      this.finalDate() !== null,
  );
  /**
   * Habilita os botoes somente quando:
   *  - form esta valido (metricId + datas)
   *  - E existe um CSV ja' enviado
   *
   * Exceção: metricId === 999 e' um dataset de demo pre-seedeado no banco
   * (ver db/seed-demo.sql) — libera sem exigir upload novo pra facilitar
   * demonstracao de paginacao/cenarios com muitos dados.
   */
  readonly isSubmittable = computed(() => {
    if (!this.isFormValid()) return false;
    if (this.metricId() === 999) return true;
    return this.lastUpload() !== null;
  });

  private readonly api = inject(ApiService);
  private readonly messages = inject(MessageService);

  consultar(): void {
    if (!this.isFormValid()) return;
    this.loading.set(true);
    this.searched.set(true);

    this.api
      .aggregate({
        metricId: this.metricId()!,
        dateInitial: this.toIsoDate(this.dateInitial()!),
        finalDate: this.toIsoDate(this.finalDate()!),
        granularity: this.granularity(),
      })
      .subscribe({
        next: (rows) => {
          this.data.set(rows);
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.messages.add({
            severity: 'error',
            summary: 'Falha na consulta',
            detail: this.extractError(err),
            life: 7000,
          });
        },
      });
  }

  baixarExcel(): void {
    if (!this.isFormValid()) return;
    const url = this.api.reportUrl({
      metricId: this.metricId()!,
      dateInitial: this.toIsoDate(this.dateInitial()!),
      finalDate: this.toIsoDate(this.finalDate()!),
    });
    window.location.href = url;
    this.messages.add({
      severity: 'info',
      summary: 'Gerando relatório',
      detail: 'O download do Excel deve iniciar em instantes.',
      life: 4000,
    });
  }

  uploadCsv(file: File): void {
    this.uploading.set(true);
    this.api.uploadCsv(file).subscribe({
      next: (res) => {
        this.uploading.set(false);
        this.lastUpload.set({
          originalName: res.originalName,
          size: res.size,
          uploadedAt: res.uploadedAt,
        });
        this.messages.add({
          severity: 'success',
          summary: 'Upload concluído',
          detail: `${res.originalName} enviado. O processamento ocorre em background.`,
          life: 5000,
        });
      },
      error: (err) => {
        this.uploading.set(false);
        this.messages.add({
          severity: 'error',
          summary: 'Falha no upload',
          detail: this.extractError(err),
          life: 7000,
        });
      },
    });
  }

  prefillFromMeta(meta: {
    metricId: number;
    firstDate: Date;
    lastDate: Date;
  }): void {
    this.metricId.set(meta.metricId);
    this.dateInitial.set(meta.firstDate);
    this.finalDate.set(meta.lastDate);
  }

  /**
   * Limpa apenas o indicador de upload no client — o blob permanece no
   * Azurite (nao ha delete remoto, porque o consumer pode ainda estar
   * processando). O efeito é voltar os botoes pro estado "precisa de CSV".
   */
  clearUpload(): void {
    const removed = this.lastUpload();
    this.lastUpload.set(null);
    if (removed) {
      this.messages.add({
        severity: 'info',
        summary: 'Arquivo removido',
        detail: removed.originalName,
        life: 3000,
      });
    }
  }

  private toIsoDate(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private extractError(err: {
    error?: { message?: string | string[] };
    status?: number;
  }): string {
    const msg = err?.error?.message;
    if (Array.isArray(msg)) return msg.join('; ');
    if (typeof msg === 'string') return msg;
    return `Erro na requisição (HTTP ${err?.status ?? '?'})`;
  }
}
