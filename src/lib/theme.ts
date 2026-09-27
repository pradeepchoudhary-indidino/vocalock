import { useEffect, useState } from 'react';

/**
 * Theme preference.
 *
 * Purely a look-and-feel choice, so unlike the lock settings it lives in the
 * WebView's own localStorage rather than in Kotlin's SharedPreferences — the
 * foreground service has no interest in it and nothing breaks if it is lost.
 *
 * 'auto' is collapsed against the system setting here so that theme.css only
 * ever has to style one explicit `data-theme` on <html>.
 */

export type ThemePref = 'auto' | 'light' | 'dark';
export type Resolved = 'light' | 'dark';

const KEY = 'vocalock.theme';

/** Status-bar backgrounds, kept in step with --bg in theme.css. */
export const THEME_BG: Record<Resolved, string> = {
  light: '#F7F6FB',
  dark: '#12111C',
};

export function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'auto') return v;
  } catch {
    /* private mode or storage blocked — fall through to the default */
  }
  return 'auto';
}

function systemIsDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function resolve(pref: ThemePref): Resolved {
  return pref === 'auto' ? (systemIsDark() ? 'dark' : 'light') : pref;
}

/* ---- the store -------------------------------------------------------- */

let pref: ThemePref = readPref();
let mode: Resolved = resolve(pref);
const listeners = new Set<() => void>();

/** Write the resolved theme onto <html> and keep <meta name=theme-color> honest. */
function paint(): void {
  document.documentElement.dataset.theme = mode;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_BG[mode]);
}

function settle(next: ThemePref): void {
  pref = next;
  const resolved = resolve(next);
  if (resolved === mode && document.documentElement.dataset.theme === mode) {
    listeners.forEach((l) => l());
    return;
  }
  mode = resolved;
  paint();
  listeners.forEach((l) => l());
}

let inited = false;

/** index.html has already painted the right theme; this adopts it. */
export function initTheme(): void {
  paint();
  // StrictMode runs effects twice in dev, and this listener lives for the whole
  // app anyway, so attach it exactly once.
  if (inited) return;
  inited = true;
  window
    .matchMedia?.('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      if (pref === 'auto') settle('auto');
    });
}

export function setThemePref(next: ThemePref): void {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* not fatal: the choice still applies for this run */
  }
  settle(next);
}

/** The preference the user picked, and the theme it currently resolves to. */
export function useTheme(): { pref: ThemePref; mode: Resolved } {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return { pref, mode };
}
