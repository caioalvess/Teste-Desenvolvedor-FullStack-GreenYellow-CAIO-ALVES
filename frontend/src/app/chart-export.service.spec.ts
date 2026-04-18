import { TestBed } from '@angular/core/testing';
import { ChartExportService } from './chart-export.service';

describe('ChartExportService', () => {
  let service: ChartExportService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [ChartExportService] });
    service = TestBed.inject(ChartExportService);
  });

  it('hasCharts inicia false', () => {
    expect(service.hasCharts()).toBe(false);
  });

  it('register: armazena o exporter e liga hasCharts', () => {
    const fn = jest.fn();
    service.register(fn);
    expect(service.hasCharts()).toBe(true);
  });

  it('unregister: zera hasCharts e remove o exporter', () => {
    const fn = jest.fn();
    service.register(fn);
    service.unregister();
    expect(service.hasCharts()).toBe(false);

    // exportAll apos unregister nao chama nada
    service.exportAll();
    expect(fn).not.toHaveBeenCalled();
  });

  it('exportAll: chama o exporter registrado', () => {
    const fn = jest.fn();
    service.register(fn);
    service.exportAll();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exportAll sem register: no-op (nao quebra)', () => {
    expect(() => service.exportAll()).not.toThrow();
  });

  it('register duas vezes: o segundo sobrescreve o primeiro', () => {
    const first = jest.fn();
    const second = jest.fn();
    service.register(first);
    service.register(second);
    service.exportAll();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
