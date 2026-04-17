import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output, signal } from '@angular/core';
import { CardModule } from 'primeng/card';
import { MessageModule } from 'primeng/message';
import { FileUploadModule } from 'primeng/fileupload';
import { ApiService } from '../api.service';
import { UploadResponse } from '../models';

@Component({
  selector: 'app-upload',
  standalone: true,
  imports: [CommonModule, CardModule, FileUploadModule, MessageModule],
  template: `
    <p-card header="1. Upload do CSV">
      <p-fileUpload
        name="file"
        accept=".csv"
        mode="basic"
        chooseLabel="Selecionar CSV"
        [auto]="true"
        [customUpload]="true"
        (uploadHandler)="onUpload($event)"
      />

      @if (loading()) {
        <p-message severity="info" text="Enviando..." styleClass="mt-3" />
      }
      @if (result()) {
        <p-message severity="success" styleClass="mt-3">
          <ng-template pTemplate>
            <span>
              Arquivo enviado: <strong>{{ result()?.originalName }}</strong>
              ({{ result()?.size | number }} bytes). Blob:
              <code>{{ result()?.blobName }}</code>
            </span>
          </ng-template>
        </p-message>
      }
      @if (error()) {
        <p-message severity="error" [text]="error() ?? ''" styleClass="mt-3" />
      }
    </p-card>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .mt-3 {
        margin-top: 1rem;
      }
    `,
  ],
})
export class UploadComponent {
  @Output() uploaded = new EventEmitter<UploadResponse>();

  readonly loading = signal(false);
  readonly result = signal<UploadResponse | null>(null);
  readonly error = signal<string | null>(null);

  constructor(private api: ApiService) {}

  onUpload(event: { files: File[] }) {
    const file = event.files?.[0];
    if (!file) return;

    this.loading.set(true);
    this.result.set(null);
    this.error.set(null);

    this.api.uploadCsv(file).subscribe({
      next: (res) => {
        this.result.set(res);
        this.loading.set(false);
        this.uploaded.emit(res);
      },
      error: (err) => {
        this.error.set(
          err?.error?.message
            ? `${err.status} — ${err.error.message}`
            : `Falha no upload (HTTP ${err?.status ?? '?'})`,
        );
        this.loading.set(false);
      },
    });
  }
}
