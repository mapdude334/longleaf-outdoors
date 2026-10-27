import { storageKey } from './environment';
export type ThemeMode = 'system' | 'light' | 'dark';
const KEY = storageKey('longleaf:theme-mode');
const MODES: ThemeMode[] = ['system', 'light', 'dark'];
let mode: ThemeMode = 'system';
const darkPreference = window.matchMedia('(prefers-color-scheme: dark)');

function readMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(KEY) as ThemeMode | null;
    return stored && MODES.includes(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme() {
  const root = document.documentElement;
  if (mode === 'system') {
    root.removeAttribute('data-theme');
  } else root.dataset.theme = mode;
  const dark = mode === 'dark' || (mode === 'system' && darkPreference.matches);
  const button = document.querySelector<HTMLButtonElement>('#theme-toggle');
  if (!button) return;
  button.setAttribute('aria-pressed', String(dark));
  button.setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} theme`);
  button.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
  button.innerHTML = dark
    ? '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg><span>Light</span>'
    : '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20.4 15.4A8.5 8.5 0 0 1 8.6 3.6 8.6 8.6 0 1 0 20.4 15.4Z"/></svg><span>Dark</span>';
}

export function initTheme() {
  mode = readMode();
  applyTheme();
  document.querySelector<HTMLButtonElement>('#theme-toggle')?.addEventListener('click', toggleTheme);
  darkPreference.addEventListener('change', applyTheme);
}

function toggleTheme() {
  const dark = mode === 'dark' || (mode === 'system' && darkPreference.matches);
  mode = dark ? 'light' : 'dark';
  try { localStorage.setItem(KEY, mode); } catch { /* Keep the chosen theme for this session. */ }
  applyTheme();
}
