import { TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { MessageService } from 'primeng/api';
import { ApiService } from './api.service';
import { MetricsStore } from './metrics.store';
import { UploadStatus, UploadState } from './models';

// Helper pra montar UploadStatus sem precisar setar blobName/error em todo lugar.
const status = (
  state: UploadState,
  rowsProcessed: number,
  error: string | null = null,
): UploadStatus => ({
  blobName: 'abc.csv',
  state,
  rowsProcessed,
  error,
});

describe('MetricsStore', () => {
  let store: MetricsStore;
  let api: jest.Mocked<ApiService>;
  let messages: { add: jest.Mock };

  beforeEach(() => {
    api = {
      uploadCsv: jest.fn(),
      aggregate: jest.fn(),
      getUploadStatus: jest.fn(),
      reportUrl: jest.fn().mockReturnValue(''),
    } as unknown as jest.Mocked<ApiService>;
    messages = { add: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        MetricsStore,
        { provide: ApiService, useValue: api },
        { provide: MessageService, useValue: messages },
      ],
    });
    store = TestBed.inject(MetricsStore);
  });

  // ------------------------------------------------------------------
  // Computeds
  // ------------------------------------------------------------------
  describe('isFormValid', () => {
    it('true somente quando metricId + dateInitial + finalDate preenchidos', () => {
      expect(store.isFormValid()).toBe(false);
      store.metricId.set(100);
      expect(store.isFormValid()).toBe(false);
      store.dateInitial.set(new Date(2024, 0, 1));
      expect(store.isFormValid()).toBe(false);
      store.finalDate.set(new Date(2024, 0, 31));
      expect(store.isFormValid()).toBe(true);
    });
  });

  describe('isSubmittable', () => {
    const fillForm = (id = 100) => {
      store.metricId.set(id);
      store.dateInitial.set(new Date(2024, 0, 1));
      store.finalDate.set(new Date(2024, 0, 31));
    };

    it('false quando form invalido', () => {
      expect(store.isSubmittable()).toBe(false);
    });

    it('metricId=999 libera sem precisar de upload (excecao do dataset demo)', () => {
      fillForm(999);
      expect(store.isSubmittable()).toBe(true);
    });

    it('outras metrics exigem lastUpload + status completed', () => {
      fillForm(100);
      expect(store.isSubmittable()).toBe(false);

      store.lastUpload.set({
        originalName: 'x.csv',
        size: 10,
        uploadedAt: '',
      });
      expect(store.isSubmittable()).toBe(false); // sem status

      store.uploadStatus.set(status('processing', 10));
      expect(store.isSubmittable()).toBe(false); // processando

      store.uploadStatus.set(status('completed', 10));
      expect(store.isSubmittable()).toBe(true);
    });
  });

  describe('total', () => {
    it('soma os values do data()', () => {
      store.data.set([
        { date: '2024-01-01', value: 5 },
        { date: '2024-01-02', value: 3 },
        { date: '2024-01-03', value: 0 },
      ]);
      expect(store.total()).toBe(8);
    });
  });

  // ------------------------------------------------------------------
  // acceptCsvFile
  // ------------------------------------------------------------------
  describe('acceptCsvFile', () => {
    it('ignora arquivos que nao sao .csv', () => {
      store.acceptCsvFile(new File(['x'], 'foo.txt'));
      expect(api.uploadCsv).not.toHaveBeenCalled();
    });

    it('aceita .csv e .CSV (case insensitive)', () => {
      api.uploadCsv.mockReturnValue(new Subject());
      store.acceptCsvFile(new File(['x'], 'data.csv'));
      store.acceptCsvFile(new File(['x'], 'DATA.CSV'));
      expect(api.uploadCsv).toHaveBeenCalledTimes(2);
    });
  });

  // ------------------------------------------------------------------
  // uploadCsv
  // ------------------------------------------------------------------
  describe('uploadCsv', () => {
    const uploadResponse = {
      blobName: 'abc.csv',
      originalName: 'data.csv',
      size: 1024,
      uploadedAt: '2024-01-01T00:00:00Z',
    };

    it('sucesso: seta lastUpload, zera uploading, toca success, inicia polling', fakeAsync(() => {
      api.uploadCsv.mockReturnValue(of(uploadResponse));
      api.getUploadStatus.mockReturnValue(new Subject()); // nunca completa

      store.uploadCsv(new File(['x'], 'data.csv'));

      expect(store.uploading()).toBe(false);
      expect(store.lastUpload()).toEqual({
        originalName: 'data.csv',
        size: 1024,
        uploadedAt: '2024-01-01T00:00:00Z',
      });
      expect(messages.add).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'success',
          summary: 'Upload concluído',
        }),
      );

      // timer(0, 500) dispara imediatamente e chama getUploadStatus
      tick(1);
      expect(api.getUploadStatus).toHaveBeenCalledWith('abc.csv');

      // para o timer infinito — evita 'periodic timer(s) still in the queue'
      store.clearUpload();
      flush();
    }));

    it('erro: zera uploading, nao chama polling, toca error', () => {
      api.uploadCsv.mockReturnValue(
        throwError(() => ({
          error: { message: 'Arquivo invalido' },
          status: 400,
        })),
      );

      store.uploadCsv(new File(['x'], 'bad.csv'));

      expect(store.uploading()).toBe(false);
      expect(store.lastUpload()).toBeNull();
      expect(api.getUploadStatus).not.toHaveBeenCalled();
      expect(messages.add).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'error',
          summary: 'Falha no upload',
          detail: 'Arquivo invalido',
        }),
      );
    });
  });

  // ------------------------------------------------------------------
  // Polling
  // ------------------------------------------------------------------
  describe('polling', () => {
    const startUpload = () => {
      api.uploadCsv.mockReturnValue(
        of({
          blobName: 'abc.csv',
          originalName: 'data.csv',
          size: 1,
          uploadedAt: '',
        }),
      );
      store.uploadCsv(new File(['x'], 'data.csv'));
    };

    it('status completed: atualiza uploadStatus, toca success, para polling', fakeAsync(() => {
      api.getUploadStatus.mockReturnValue(of(status('completed', 12345)));

      startUpload();
      tick(1); // primeiro tick do timer

      expect(store.uploadStatus()).toEqual(status('completed', 12345));
      expect(messages.add).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'success',
          summary: 'Processamento concluído',
          detail: expect.stringContaining('12.345'),
        }),
      );

      // apos completed o poll parou: avancar o tempo nao deve chamar api denovo
      const callsAntes = api.getUploadStatus.mock.calls.length;
      tick(600);
      expect(api.getUploadStatus.mock.calls.length).toBe(callsAntes);
    }));

    it('status failed: atualiza status, toca error, para polling', fakeAsync(() => {
      api.getUploadStatus.mockReturnValue(of(status('failed', 0, 'boom')));

      startUpload();
      tick(1);

      expect(store.uploadStatus()?.state).toBe('failed');
      expect(messages.add).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'error',
          summary: 'Falha no processamento',
          detail: 'boom',
        }),
      );
    }));

    it('404 transitorio num tick nao derruba o polling', fakeAsync(() => {
      let calls = 0;
      api.getUploadStatus.mockImplementation(() => {
        calls += 1;
        if (calls === 1) return throwError(() => new Error('404'));
        return of(status('completed', 1));
      });

      startUpload();
      tick(1); // primeiro tick: erro silenciado, status continua null
      expect(store.uploadStatus()).toBeNull();

      tick(500); // segundo tick: sucesso
      expect(store.uploadStatus()?.state).toBe('completed');
    }));
  });

  // ------------------------------------------------------------------
  // clearUpload
  // ------------------------------------------------------------------
  describe('clearUpload', () => {
    it('reseta lastUpload + uploadStatus e toca toast info', () => {
      store.lastUpload.set({
        originalName: 'x.csv',
        size: 0,
        uploadedAt: '',
      });
      store.uploadStatus.set(status('processing', 10));

      store.clearUpload();

      expect(store.lastUpload()).toBeNull();
      expect(store.uploadStatus()).toBeNull();
      expect(messages.add).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'info',
          summary: 'Arquivo removido',
          detail: 'x.csv',
        }),
      );
    });

    it('sem upload anterior: nao dispara toast', () => {
      store.clearUpload();
      expect(messages.add).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------------------
  // consultar
  // ------------------------------------------------------------------
  describe('consultar', () => {
    const fillForm = () => {
      store.metricId.set(42);
      store.dateInitial.set(new Date(2024, 0, 1));
      store.finalDate.set(new Date(2024, 0, 31));
      store.granularity.set('DAY');
    };

    it('no-op quando o form e invalido', () => {
      store.consultar();
      expect(api.aggregate).not.toHaveBeenCalled();
    });

    it('sucesso: popula data, marca searched=true, loading=false', () => {
      fillForm();
      const rows = [
        { date: '2024-01-10', value: 7 },
        { date: '2024-01-11', value: 5 },
      ];
      api.aggregate.mockReturnValue(of(rows));

      store.consultar();

      expect(api.aggregate).toHaveBeenCalledWith({
        metricId: 42,
        dateInitial: '2024-01-01',
        finalDate: '2024-01-31',
        granularity: 'DAY',
      });
      expect(store.data()).toEqual(rows);
      expect(store.loading()).toBe(false);
      expect(store.searched()).toBe(true);
    });

    it('erro: mantem loading=false e toca error com mensagem extraida', () => {
      fillForm();
      api.aggregate.mockReturnValue(
        throwError(() => ({
          error: { message: ['Range invalido', 'MetricId obrigatorio'] },
          status: 400,
        })),
      );

      store.consultar();

      expect(store.loading()).toBe(false);
      expect(messages.add).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'error',
          summary: 'Falha na consulta',
          detail: 'Range invalido; MetricId obrigatorio',
        }),
      );
    });
  });
});
