import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, catchError, of, switchMap, timer } from 'rxjs';
import { MessageService } from 'primeng/api';
import { ApiService } from './api.service';
import { extractCsvMeta } from './csv-meta.util';
import { formatNumber } from './format.util';
import { AggregatedPoint, Granularity, UploadStatus } from './models';

const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 120_000;

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
  readonly uploadStatus = signal<UploadStatus | null>(null);
  private pollSub?: Subscription;

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
    // CSV precisa estar enviado E processamento concluido (ou desconhecido por
    // reload da pagina — nesse caso lastUpload seria null e cairia no false).
    if (this.lastUpload() === null) return false;
    const status = this.uploadStatus();
    if (!status) return false;
    return status.state === 'completed';
  });

  private readonly api = inject(ApiService);
  private readonly messages = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

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

  /**
   * Entrada unica pra um arquivo CSV vindo da UI (dropzone ou file picker):
   * valida extensao, dispara o prefill do form a partir dos metadados
   * do CSV em paralelo (best-effort) e inicia o upload.
   */
  acceptCsvFile(file: File): void {
    if (!file.name.toLowerCase().endsWith('.csv')) return;
    this.prefillFromFile(file).catch(() => undefined);
    this.uploadCsv(file);
  }

  uploadCsv(file: File): void {
    this.uploading.set(true);
    this.uploadStatus.set(null);
    this.stopPolling();

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
          detail: `${res.originalName} enviado. Processando…`,
          life: 4000,
        });
        this.startPolling(res.blobName);
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

  /**
   * Polling do status de processamento via RxJS timer. Cancela
   * automaticamente quando o status fica terminal (completed/failed),
   * quando estoura timeout, quando um novo upload comeca (stopPolling)
   * ou quando o injector root e' destruido (takeUntilDestroyed).
   *
   * Erros de tick individual (ex.: 404 transitorio enquanto a mensagem
   * ainda nao foi consumida) sao silenciados com catchError -> of(null).
   */
  private startPolling(blobName: string): void {
    this.stopPolling();
    const startedAt = Date.now();

    this.pollSub = timer(0, POLL_INTERVAL_MS)
      .pipe(
        switchMap(() =>
          this.api
            .getUploadStatus(blobName)
            .pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((status) => {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          this.stopPolling();
          this.messages.add({
            severity: 'warn',
            summary: 'Processamento demorado',
            detail:
              'Ainda não concluído após 2 minutos. Tente recarregar a página ou faça novo upload.',
            life: 8000,
          });
          return;
        }
        if (!status) return; // tick com erro transitorio — ignora
        this.uploadStatus.set(status);
        if (status.state === 'completed') {
          this.stopPolling();
          this.messages.add({
            severity: 'success',
            summary: 'Processamento concluído',
            detail: `${formatNumber(status.rowsProcessed)} linhas indexadas.`,
            life: 4000,
          });
        } else if (status.state === 'failed') {
          this.stopPolling();
          this.messages.add({
            severity: 'error',
            summary: 'Falha no processamento',
            detail: status.error ?? 'Erro desconhecido.',
            life: 8000,
          });
        }
      });
  }

  private stopPolling(): void {
    this.pollSub?.unsubscribe();
    this.pollSub = undefined;
  }

  private async prefillFromFile(file: File): Promise<void> {
    const meta = await extractCsvMeta(file);
    if (meta.metricId !== null && meta.firstDate && meta.lastDate) {
      this.prefillFromMeta({
        metricId: meta.metricId,
        firstDate: meta.firstDate,
        lastDate: meta.lastDate,
      });
    }
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
    this.stopPolling();
    this.lastUpload.set(null);
    this.uploadStatus.set(null);
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
