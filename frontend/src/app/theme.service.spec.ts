import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

const STORAGE_KEY = 'gy-theme';

/**
 * Stub pro window.matchMedia (jsdom nao implementa).
 * prefersDark = valor retornado pela query '(prefers-color-scheme: dark)'.
 */
function stubMatchMedia(prefersDark: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: query.includes('dark') ? prefersDark : false,
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
}

/** Dispara a execução do effect() do service. */
function flushEffects(): void {
  TestBed.flushEffects();
}

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('inicializa em light quando nao ha preferencia salva nem SO em dark', () => {
    stubMatchMedia(false);
    TestBed.configureTestingModule({ providers: [ThemeService] });
    const svc = TestBed.inject(ThemeService);

    expect(svc.theme()).toBe('light');
  });

  it('ignora prefers-color-scheme: dark do SO e mantem light como default', () => {
    // Regra do projeto: sem preferencia salva, default sempre light
    // (consistencia visual pra novos visitantes, independente do SO).
    stubMatchMedia(true);
    TestBed.configureTestingModule({ providers: [ThemeService] });
    const svc = TestBed.inject(ThemeService);

    expect(svc.theme()).toBe('light');
  });

  it('preferencia do localStorage tem prioridade sobre o SO', () => {
    // SO diz dark, mas usuario ja escolheu light antes
    stubMatchMedia(true);
    localStorage.setItem(STORAGE_KEY, 'light');

    TestBed.configureTestingModule({ providers: [ThemeService] });
    const svc = TestBed.inject(ThemeService);

    expect(svc.theme()).toBe('light');
  });

  it('ignora valores invalidos no localStorage e cai no default light', () => {
    stubMatchMedia(true);
    localStorage.setItem(STORAGE_KEY, 'invalid-theme');

    TestBed.configureTestingModule({ providers: [ThemeService] });
    const svc = TestBed.inject(ThemeService);

    expect(svc.theme()).toBe('light');
  });

  it('toggle alterna light <-> dark', () => {
    stubMatchMedia(false);
    TestBed.configureTestingModule({ providers: [ThemeService] });
    const svc = TestBed.inject(ThemeService);

    expect(svc.theme()).toBe('light');
    svc.toggle();
    expect(svc.theme()).toBe('dark');
    svc.toggle();
    expect(svc.theme()).toBe('light');
  });

  it('effect aplica data-theme no <html> e persiste no localStorage', () => {
    stubMatchMedia(false);
    TestBed.configureTestingModule({ providers: [ThemeService] });
    const svc = TestBed.inject(ThemeService);

    // Effect do construtor roda no primeiro tick
    flushEffects();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light');

    // Mudar o signal propaga pros dois efeitos
    svc.toggle();
    flushEffects();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
  });
});
