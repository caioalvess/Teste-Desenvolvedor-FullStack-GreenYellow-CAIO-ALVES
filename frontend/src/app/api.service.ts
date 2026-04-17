import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  AggregatedPoint,
  AggregateQuery,
  UploadResponse,
  UploadStatus,
} from './models';

const API_BASE =
  (window as unknown as { __API_BASE__?: string }).__API_BASE__ ??
  'http://localhost:3001';

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private http: HttpClient) {}

  uploadCsv(file: File): Observable<UploadResponse> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http.post<UploadResponse>(`${API_BASE}/uploads`, form);
  }

  aggregate(q: AggregateQuery): Observable<AggregatedPoint[]> {
    const params = new HttpParams()
      .set('metricId', q.metricId)
      .set('dateInitial', q.dateInitial)
      .set('finalDate', q.finalDate)
      .set('granularity', q.granularity);
    return this.http.get<AggregatedPoint[]>(`${API_BASE}/metrics/aggregate`, {
      params,
    });
  }

  getUploadStatus(blobName: string): Observable<UploadStatus> {
    return this.http.get<UploadStatus>(
      `${API_BASE}/uploads/${encodeURIComponent(blobName)}/status`,
    );
  }

  reportUrl(q: Omit<AggregateQuery, 'granularity'>): string {
    const params = new URLSearchParams({
      metricId: String(q.metricId),
      dateInitial: q.dateInitial,
      finalDate: q.finalDate,
    });
    return `${API_BASE}/metrics/report?${params.toString()}`;
  }
}
