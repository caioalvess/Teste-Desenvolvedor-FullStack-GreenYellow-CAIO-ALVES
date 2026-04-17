import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { ApiService } from './api.service';

const API_BASE = 'http://localhost:3001';

describe('ApiService', () => {
  let service: ApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ApiService],
    });
    service = TestBed.inject(ApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify(); // garante que nenhuma req ficou pendente
  });

  describe('uploadCsv', () => {
    it('POST /uploads com FormData contendo o arquivo', () => {
      const file = new File(['metric;dt;v\n1;01/01/2024 00:00;1'], 'x.csv', {
        type: 'text/csv',
      });

      service.uploadCsv(file).subscribe();

      const req = http.expectOne(`${API_BASE}/uploads`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toBeInstanceOf(FormData);
      const form = req.request.body as FormData;
      const sent = form.get('file');
      expect(sent).toBeInstanceOf(File);
      expect((sent as File).name).toBe('x.csv');
      req.flush({
        blobName: 'abc.csv',
        originalName: 'x.csv',
        size: 36,
        uploadedAt: '2024-01-01T00:00:00Z',
      });
    });
  });

  describe('aggregate', () => {
    it('GET /metrics/aggregate com todos os params de query', () => {
      service
        .aggregate({
          metricId: 218219,
          dateInitial: '2023-11-01',
          finalDate: '2023-11-30',
          granularity: 'DAY',
        })
        .subscribe();

      const req = http.expectOne(
        (r) => r.url === `${API_BASE}/metrics/aggregate`,
      );
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('metricId')).toBe('218219');
      expect(req.request.params.get('dateInitial')).toBe('2023-11-01');
      expect(req.request.params.get('finalDate')).toBe('2023-11-30');
      expect(req.request.params.get('granularity')).toBe('DAY');
      req.flush([]);
    });

    it('propaga o array de pontos do response', (done) => {
      const payload = [
        { date: '2023-11-10', value: 7 },
        { date: '2023-11-11', value: 5 },
      ];

      service
        .aggregate({
          metricId: 1,
          dateInitial: '2023-11-01',
          finalDate: '2023-11-30',
          granularity: 'DAY',
        })
        .subscribe((rows) => {
          expect(rows).toEqual(payload);
          done();
        });

      http.expectOne(`${API_BASE}/metrics/aggregate?metricId=1&dateInitial=2023-11-01&finalDate=2023-11-30&granularity=DAY`).flush(payload);
    });
  });

  describe('getUploadStatus', () => {
    it('encode o blobName na URL', () => {
      // blob name com caracteres especiais (/, espaco) pra validar encoding
      service.getUploadStatus('pasta/arquivo com espaco.csv').subscribe();

      const req = http.expectOne((r) => r.url.includes('/uploads/'));
      expect(req.request.method).toBe('GET');
      // encodeURIComponent transforma: "/" -> "%2F", " " -> "%20"
      expect(req.request.url).toBe(
        `${API_BASE}/uploads/pasta%2Farquivo%20com%20espaco.csv/status`,
      );
      req.flush({ state: 'completed', rowsProcessed: 100 });
    });
  });

  describe('reportUrl', () => {
    it('monta URL com query string sem fazer request', () => {
      const url = service.reportUrl({
        metricId: 42,
        dateInitial: '2024-01-01',
        finalDate: '2024-01-31',
      });
      expect(url).toBe(
        `${API_BASE}/metrics/report?metricId=42&dateInitial=2024-01-01&finalDate=2024-01-31`,
      );
      // nenhuma req deve ter acontecido
      http.expectNone(() => true);
    });
  });
});
