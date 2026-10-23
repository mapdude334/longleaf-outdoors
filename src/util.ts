export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector(sel) as T;

export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export async function fetchJSON<T = any>(url: string, opts: RequestInit & { timeout?: number } = {}): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts.timeout ?? 20000);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${url}`);
    return (await r.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

/** Tiny persisted cache for "last known" live data so popups still work offline. */
export const store = {
  get<T>(k: string): { t: number; v: T } | null {
    try {
      const s = localStorage.getItem('vw:' + k);
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  },
  set<T>(k: string, v: T) {
    try {
      localStorage.setItem('vw:' + k, JSON.stringify({ t: Date.now(), v }));
    } catch (e) {
      console.warn('storage full?', e);
    }
  },
  del(k: string) {
    try { localStorage.removeItem('vw:' + k); } catch { /* ignore */ }
  },
};

/** Live fetch with fallback to the last cached copy. */
export async function cachedLive<T>(key: string, maxAgeMs: number, fn: () => Promise<T>): Promise<{ v: T; t: number; offline: boolean }> {
  const c = store.get<T>(key);
  if (c && Date.now() - c.t < maxAgeMs) return { v: c.v, t: c.t, offline: false };
  try {
    const v = await fn();
    store.set(key, v);
    return { v, t: Date.now(), offline: false };
  } catch (e) {
    if (c) return { v: c.v, t: c.t, offline: true };
    throw e;
  }
}

export function ago(t: number | string): string {
  const ms = Date.now() - (typeof t === 'string' ? Date.parse(t) : t);
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hr ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function fmtCoord(lng: number, lat: number, mode: 'dd' | 'dm' = 'dd') {
  if (mode === 'dd') return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const f = (v: number, p: string, n: string) => {
    const a = Math.abs(v);
    const d = Math.floor(a);
    return `${d}°${((a - d) * 60).toFixed(3)}′${v >= 0 ? p : n}`;
  };
  return `${f(lat, 'N', 'S')} ${f(lng, 'E', 'W')}`;
}

export function haversineKm(a: [number, number], b: [number, number]) {
  const R = 6371;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(b[1] - a[1]);
  const dLon = toR(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[1])) * Math.cos(toR(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function toast(msg: string, ms = 3500) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, ms);
}

export function sparkline(values: number[], w = 220, h = 44): string {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return '';
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min || 1;
  const pts = v.map((y, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - 3 - ((y - min) / span) * (h - 6)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="2" points="${pts}"/></svg>`;
}

export function propsTable(p: Record<string, unknown>, skip: RegExp = /^(_|OBJECTID|Shape|SHAPE|FID|GlobalID)/): string {
  const rows = Object.entries(p)
    .filter(([k, v]) => !skip.test(k) && v !== null && v !== '' && v !== undefined)
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
    .join('');
  return rows ? `<table class="props">${rows}</table>` : '<p class="muted">No attributes.</p>';
}
