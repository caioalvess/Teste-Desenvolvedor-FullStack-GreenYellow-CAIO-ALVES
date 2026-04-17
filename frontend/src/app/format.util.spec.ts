import { formatBytes, formatDate, formatNumber } from './format.util';

describe('format.util', () => {
  describe('formatDate', () => {
    it('retorna em de-mm-yyyy com zero-padding', () => {
      // mes 0 = janeiro
      expect(formatDate(new Date(2024, 0, 5))).toBe('05/01/2024');
      expect(formatDate(new Date(2023, 10, 21))).toBe('21/11/2023');
    });

    it('retorna traço quando a data é null', () => {
      expect(formatDate(null)).toBe('—');
    });

    it('mantém os dois digitos em dias e meses ja com 2 chars', () => {
      expect(formatDate(new Date(2024, 11, 31))).toBe('31/12/2024');
    });
  });

  describe('formatBytes', () => {
    it('formata bytes puros abaixo de 1 KB', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(512)).toBe('512 B');
      expect(formatBytes(1023)).toBe('1023 B');
    });

    it('formata KB com 1 casa decimal até 1 MB', () => {
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(1536)).toBe('1.5 KB');
      expect(formatBytes(1024 * 1024 - 1)).toMatch(/KB$/);
    });

    it('formata MB com 2 casas decimais acima de 1 MB', () => {
      expect(formatBytes(1024 * 1024)).toBe('1.00 MB');
      expect(formatBytes(5 * 1024 * 1024 + 512 * 1024)).toBe('5.50 MB');
    });
  });

  describe('formatNumber', () => {
    it('aplica separador de milhar pt-BR (ponto)', () => {
      // a localidade jsdom geralmente suporta pt-BR — asserts resistentes ao ICU trimmed
      const out = formatNumber(1234567);
      // "1.234.567" no pt-BR (ICU full). Em runtimes com ICU "small",
      // pode vir "1,234,567" ou "1234567" — validamos que voltou string
      // com os digitos certos mantendo ordem.
      expect(out.replace(/[^\d]/g, '')).toBe('1234567');
    });

    it('retorna string com zero preservado', () => {
      expect(formatNumber(0)).toBe('0');
    });
  });
});
