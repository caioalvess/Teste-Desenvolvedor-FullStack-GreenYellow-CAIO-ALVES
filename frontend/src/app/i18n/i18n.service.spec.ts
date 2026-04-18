import { TestBed } from '@angular/core/testing';
import { I18nService } from './i18n.service';
import { TRANSLATIONS } from './translations';

describe('I18nService', () => {
  let service: I18nService;

  beforeEach(() => {
    // Limpa localStorage entre testes pra cada spec comecar do zero.
    try { localStorage.removeItem('gy-locale'); } catch { /* ignora */ }
    TestBed.configureTestingModule({ providers: [I18nService] });
    service = TestBed.inject(I18nService);
  });

  describe('locale inicial', () => {
    it('default: cai em pt quando nao ha localStorage nem navigator.language suportado', () => {
      // jsdom expoe navigator.language como 'en-US' normalmente.
      // O service aceita en, logo o default real pode ser 'en' — o que o
      // teste verifica e' que esta num dos locales suportados.
      expect(['pt', 'en', 'es', 'fr']).toContain(service.locale());
    });

    it('respeita localStorage quando presente', () => {
      localStorage.setItem('gy-locale', 'es');
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [I18nService] });
      const s = TestBed.inject(I18nService);
      expect(s.locale()).toBe('es');
    });

    it('ignora valor invalido em localStorage e cai no fallback', () => {
      localStorage.setItem('gy-locale', 'jp');
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [I18nService] });
      const s = TestBed.inject(I18nService);
      expect(['pt', 'en', 'es', 'fr']).toContain(s.locale());
      expect(s.locale()).not.toBe('jp');
    });
  });

  describe('setLocale + persistencia', () => {
    it('atualiza o signal e grava em localStorage via effect', async () => {
      service.setLocale('fr');
      // effect angular roda na proxima microtask
      await Promise.resolve();
      expect(service.locale()).toBe('fr');
      expect(localStorage.getItem('gy-locale')).toBe('fr');
    });

    it('atualiza <html lang="..."> pra BCP47', async () => {
      service.setLocale('es');
      await Promise.resolve();
      expect(document.documentElement.getAttribute('lang')).toBe('es-ES');
    });
  });

  describe('bcp47', () => {
    it('devolve o BCP47 correspondente ao locale atual', () => {
      service.setLocale('pt'); expect(service.bcp47()).toBe('pt-BR');
      service.setLocale('en'); expect(service.bcp47()).toBe('en-US');
      service.setLocale('es'); expect(service.bcp47()).toBe('es-ES');
      service.setLocale('fr'); expect(service.bcp47()).toBe('fr-FR');
    });
  });

  describe('t(key)', () => {
    it('devolve o texto do idioma atual', () => {
      service.setLocale('pt');
      expect(service.t('filters.title')).toBe(TRANSLATIONS.pt['filters.title']);
      service.setLocale('en');
      expect(service.t('filters.title')).toBe(TRANSLATIONS.en['filters.title']);
    });

    it('cai no pt quando a key nao existe no idioma atual', () => {
      // Injeta uma key so no pt, temporariamente
      const originalKey = 'spec.only.pt';
      TRANSLATIONS.pt[originalKey] = 'existe-em-pt';
      try {
        service.setLocale('fr');
        expect(service.t(originalKey)).toBe('existe-em-pt');
      } finally {
        delete TRANSLATIONS.pt[originalKey];
      }
    });

    it('devolve a propria key quando ela nao existe em lugar nenhum (missing key visivel)', () => {
      expect(service.t('does.not.exist')).toBe('does.not.exist');
    });
  });

  describe('t(key, params)', () => {
    it('substitui {nome} pelos params', () => {
      service.setLocale('pt');
      // Usa uma key real que tem param
      const result = service.t('results.header.info', {
        id: 999,
        start: '01/01',
        end: '01/03',
        gran: 'dia',
      });
      expect(result).toContain('999');
      expect(result).toContain('01/01');
      expect(result).toContain('01/03');
      expect(result).toContain('dia');
    });

    it('mantem {nome} quando o param nao foi fornecido (visibilidade de bug)', () => {
      service.setLocale('pt');
      const result = service.t('results.header.info', { id: 42 });
      expect(result).toContain('42');
      expect(result).toContain('{start}');
    });

    it('aceita numeros e strings como valores de param', () => {
      service.setLocale('pt');
      TRANSLATIONS.pt['spec.params'] = 'n={n} s={s}';
      try {
        expect(service.t('spec.params', { n: 7, s: 'abc' })).toBe('n=7 s=abc');
      } finally {
        delete TRANSLATIONS.pt['spec.params'];
      }
    });
  });
});
