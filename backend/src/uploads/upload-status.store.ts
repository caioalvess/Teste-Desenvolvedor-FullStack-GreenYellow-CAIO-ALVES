import { Injectable } from '@nestjs/common';

export type UploadState = 'pending' | 'processing' | 'completed' | 'failed';

export interface UploadStatus {
  blobName: string;
  state: UploadState;
  rowsProcessed: number;
  error: string | null;
  startedAt?: string;
  completedAt?: string;
}

/**
 * Store in-memory que registra o ciclo de vida de processamento de cada blob:
 *
 *   register → pending  (apos upload, antes do consumer pegar)
 *             ↓
 *            start → processing  (consumer comecou)
 *             ↓
 *        incrementRows × N       (cada batch inserido)
 *             ↓
 *   complete → completed   OU    fail → failed
 *
 * Limitações:
 *  - In-memory: perde estado em restart do processo (API + consumer no mesmo).
 *  - Para producao valeria persistir em Redis ou numa tabela de jobs no Postgres.
 *    Anotado em melhorias. Para o escopo do teste, in-memory e' suficiente.
 */
@Injectable()
export class UploadStatusStore {
  private readonly states = new Map<string, UploadStatus>();

  register(blobName: string): void {
    this.states.set(blobName, {
      blobName,
      state: 'pending',
      rowsProcessed: 0,
      error: null,
    });
  }

  start(blobName: string): void {
    const existing = this.states.get(blobName);
    this.states.set(blobName, {
      blobName,
      state: 'processing',
      rowsProcessed: 0,
      error: null,
      startedAt: new Date().toISOString(),
      completedAt: existing?.completedAt,
    });
  }

  incrementRows(blobName: string, n: number): void {
    const s = this.states.get(blobName);
    if (!s) return;
    s.rowsProcessed += n;
  }

  complete(blobName: string): void {
    const s = this.states.get(blobName);
    if (!s) return;
    s.state = 'completed';
    s.completedAt = new Date().toISOString();
  }

  fail(blobName: string, error: string): void {
    const s = this.states.get(blobName);
    if (!s) return;
    s.state = 'failed';
    s.error = error;
    s.completedAt = new Date().toISOString();
  }

  get(blobName: string): UploadStatus | null {
    return this.states.get(blobName) ?? null;
  }
}
