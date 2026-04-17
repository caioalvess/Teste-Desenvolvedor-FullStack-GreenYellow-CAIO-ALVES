export type Granularity = 'DAY' | 'MONTH' | 'YEAR';

export interface UploadResponse {
  blobName: string;
  originalName: string;
  uploadedAt: string;
  size: number;
}

export interface AggregatedPoint {
  date: string;
  value: number;
}

export interface AggregateQuery {
  metricId: number;
  dateInitial: string;
  finalDate: string;
  granularity: Granularity;
}

export type UploadState = 'pending' | 'processing' | 'completed' | 'failed';

export interface UploadStatus {
  blobName: string;
  state: UploadState;
  rowsProcessed: number;
  error: string | null;
  startedAt?: string;
  completedAt?: string;
}
