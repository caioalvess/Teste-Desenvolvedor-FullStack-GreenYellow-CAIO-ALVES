import {
  AfterViewInit,
  Directive,
  ElementRef,
  OnDestroy,
} from '@angular/core';

/**
 * Mascara DD-MM-AAAA pra aplicar no <input> interno do <p-calendar>.
 *
 * Como funciona:
 *  - Pega o <input> real via querySelector no ngAfterViewInit
 *  - Intercepta o evento 'input' em capture phase (roda ANTES do handler
 *    interno do PrimeNG Calendar)
 *  - Extrai apenas digitos (max 8), reformata como DD-MM-AAAA, e atribui
 *    de volta em input.value
 *  - O handler do Calendar (bubble phase) le input.value ja' mascarado
 *    e o parser dele (dateFormat="dd-mm-yy") consome sem retrabalho
 */
@Directive({
  selector: '[appDateMask]',
  standalone: true,
})
export class DateMaskDirective implements AfterViewInit, OnDestroy {
  private input: HTMLInputElement | null = null;
  private listener: ((e: Event) => void) | null = null;

  constructor(private host: ElementRef<HTMLElement>) {}

  ngAfterViewInit(): void {
    this.input = this.host.nativeElement.querySelector('input');
    if (!this.input) return;
    this.input.setAttribute('inputmode', 'numeric');
    this.input.setAttribute('maxlength', '10');
    this.listener = (e) => this.onInput(e);
    this.input.addEventListener('input', this.listener, true);
  }

  ngOnDestroy(): void {
    if (this.input && this.listener) {
      this.input.removeEventListener('input', this.listener, true);
    }
  }

  private onInput(e: Event): void {
    const input = e.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').slice(0, 8);
    const masked = this.mask(digits);
    if (input.value !== masked) {
      input.value = masked;
      const pos = masked.length;
      try {
        input.setSelectionRange(pos, pos);
      } catch {
        // alguns tipos de input nao suportam setSelectionRange — ignoravel
      }
    }
  }

  private mask(digits: string): string {
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) {
      return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    }
    return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
  }
}
