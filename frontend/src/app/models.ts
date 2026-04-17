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
