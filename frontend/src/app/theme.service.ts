import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';

export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'gy-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  readonly theme = signal<Theme>(this.readInitial());

  constructor() {
    // Sincroniza o signal com o DOM sempre que mudar
    effect(() => {
      const value = this.theme();
      this.doc.documentElement.setAttribute('data-theme', value);
      try {
        localStorage.setItem(STORAGE_KEY, value);
      } catch {
        // localStorage pode estar bloqueado (modo privado, SSR, etc.) — seguimos
      }
    });
  }

  toggle(): void {
    this.theme.update((t) => (t === 'dark' ? 'light' : 'dark'));
  }

  private readInitial(): Theme {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      // ignore
    }
    const mql = window.matchMedia?.('(prefers-color-scheme: dark)');
    return mql?.matches ? 'dark' : 'light';
  }
}
