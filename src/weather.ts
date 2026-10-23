// NWS forecast, alerts, latest observation (incl. barometric pressure) + sun/moon/solunar.
import * as SunCalc from 'suncalc';
import { cachedLive, esc, fetchJSON, ago } from './util';

const NWS = 'https://api.weather.gov';
const H = { headers: { Accept: 'application/geo+json' }, timeout: 15000 };

type Period = { name: string; startTime: string; temperature: number; temperatureUnit: string; windSpeed: string; windDirection: string; shortForecast: string; detailedForecast: string; probabilityOfPrecipitation?: { value: number | null }; isDaytime: boolean };

export async function weatherFor(lng: number, lat: number) {
  const key = `wx:${lat.toFixed(2)},${lng.toFixed(2)}`;
  return cachedLive(key, 20 * 60_000, async () => {
    const pt = await fetchJSON<any>(`${NWS}/points/${lat.toFixed(4)},${lng.toFixed(4)}`, H);
    const p = pt.properties;
    const [fc, hourly, alerts, stations] = await Promise.all([
      fetchJSON<any>(p.forecast, H),
      fetchJSON<any>(p.forecastHourly, H).catch(() => null),
      fetchJSON<any>(`${NWS}/alerts/active?point=${lat.toFixed(4)},${lng.toFixed(4)}`, H).catch(() => null),
      fetchJSON<any>(p.observationStations, H).catch(() => null),
    ]);
    let obs: any = null;
    const st = stations?.features?.[0];
    if (st) obs = await fetchJSON<any>(`${st.id}/observations/latest`, H).catch(() => null);
    return {
      place: `${p.relativeLocation?.properties?.city ?? ''}, ${p.relativeLocation?.properties?.state ?? ''}`,
      periods: (fc.properties?.periods ?? []).slice(0, 8) as Period[],
      hourly: (hourly?.properties?.periods ?? []).slice(0, 24) as Period[],
      alerts: (alerts?.features ?? []).map((f: any) => ({ event: f.properties.event, headline: f.properties.headline, severity: f.properties.severity })),
      obs: obs?.properties ? {
        station: st.properties?.name,
        time: obs.properties.timestamp,
        tempF: cToF(obs.properties.temperature?.value),
        windMph: kmhToMph(obs.properties.windSpeed?.value),
        windDir: obs.properties.windDirection?.value,
        pressureInHg: obs.properties.barometricPressure?.value != null ? obs.properties.barometricPressure.value / 3386.389 : null,
        text: obs.properties.textDescription,
      } : null,
    };
  });
}

const cToF = (c: number | null | undefined) => (c == null ? null : c * 9 / 5 + 32);
const kmhToMph = (k: number | null | undefined) => (k == null ? null : k / 1.609);
const compass = (deg: number | null | undefined) => (deg == null ? '' : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8]);
const t = (d: Date | null | undefined) => (d && !isNaN(+d) ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—');

/** Solunar approximation: major periods = moon transit/underfoot (±1h), minor = moonrise/moonset (±30m). */
export function solunar(lng: number, lat: number, date = new Date()) {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  const sun = SunCalc.getTimes(new Date(day.getTime() + 12 * 3600_000), lat, lng);
  const moon = SunCalc.getMoonTimes(day, lat, lng);
  const illum = SunCalc.getMoonIllumination(date);
  // find transit (max altitude) and underfoot (min altitude) by 5-minute sampling
  let maxA = -Infinity, minA = Infinity, transit = day, under = day;
  for (let m = 0; m < 1440; m += 5) {
    const d = new Date(day.getTime() + m * 60000);
    const a = SunCalc.getMoonPosition(d, lat, lng).altitude;
    if (a > maxA) { maxA = a; transit = d; }
    if (a < minA) { minA = a; under = d; }
  }
  const phaseName = (p: number) =>
    p < 0.03 || p > 0.97 ? 'New moon' : p < 0.22 ? 'Waxing crescent' : p < 0.28 ? 'First quarter' : p < 0.47 ? 'Waxing gibbous'
      : p < 0.53 ? 'Full moon' : p < 0.72 ? 'Waning gibbous' : p < 0.78 ? 'Last quarter' : 'Waning crescent';
  const win = (d: Date | null | undefined, mins: number) => (d ? `${t(new Date(+d - mins * 60000))}–${t(new Date(+d + mins * 60000))}` : null);
  return {
    sunrise: sun.sunrise, sunset: sun.sunset, dawn: sun.dawn, dusk: sun.dusk,
    moonrise: moon.rise, moonset: moon.set, phase: phaseName(illum.phase), illum: Math.round(illum.fraction * 100),
    majors: [win(transit, 60), win(under, 60)].filter(Boolean) as string[],
    minors: [win(moon.rise, 30), win(moon.set, 30)].filter(Boolean) as string[],
  };
}

export async function weatherHtml(lng: number, lat: number): Promise<string> {
  const s = solunar(lng, lat);
  const astro = `<h4>Sun & moon (today)</h4>
    <table class="props">
      <tr><th>Sunrise / sunset</th><td>${t(s.sunrise)} / ${t(s.sunset)}</td></tr>
      <tr><th>First light / last light</th><td>${t(s.dawn)} / ${t(s.dusk)}</td></tr>
      <tr><th>Moon</th><td>${esc(s.phase)} (${s.illum}% lit) · rise ${t(s.moonrise)} · set ${t(s.moonset)}</td></tr>
      <tr><th>Solunar major</th><td>${s.majors.join(', ')}</td></tr>
      <tr><th>Solunar minor</th><td>${s.minors.join(', ') || '—'}</td></tr>
    </table>`;
  try {
    const { v, t: fetched, offline } = await weatherFor(lng, lat);
    const alerts = v.alerts.length
      ? v.alerts.map((a: any) => `<div class="callout ${a.severity === 'Extreme' || a.severity === 'Severe' ? 'danger' : 'warn'}"><strong>${esc(a.event)}</strong><br>${esc(a.headline)}</div>`).join('')
      : '';
    const o = v.obs;
    const now = o ? `<h4>Now <span class="muted small">${esc(o.station ?? '')} · ${esc(ago(o.time))}</span></h4>
      <div class="wx-now">
        <div><span class="big">${o.tempF != null ? Math.round(o.tempF) + '°' : '—'}</span><br>${esc(o.text ?? '')}</div>
        <div>Wind ${o.windMph != null ? Math.round(o.windMph) + ' mph ' + compass(o.windDir) : '—'}<br>
        Pressure ${o.pressureInHg != null ? o.pressureInHg.toFixed(2) + ' inHg' : '—'}</div>
      </div>` : '';
    const hourly = v.hourly.length ? `<h4>Next 24 hours</h4><div class="hourly">${v.hourly.map((h: Period) =>
      `<div><b>${new Date(h.startTime).toLocaleTimeString([], { hour: 'numeric' })}</b><br>${h.temperature}°<br><span class="muted">${h.probabilityOfPrecipitation?.value ?? 0}%</span><br><span class="muted small">${esc(h.windSpeed.replace(' mph', ''))} ${esc(h.windDirection)}</span></div>`).join('')}</div>` : '';
    const periods = v.periods.map((p: Period) => `<details><summary><b>${esc(p.name)}</b> ${p.temperature}°${p.temperatureUnit} · ${esc(p.shortForecast)}</summary><p>${esc(p.detailedForecast)}</p></details>`).join('');
    return `<h3>Weather – ${esc(v.place)}</h3>${offline ? `<p class="callout">Offline — showing forecast from ${esc(ago(fetched))}.</p>` : ''}
      ${alerts}${now}${hourly}<h4>Forecast</h4>${periods}${astro}
      <p class="muted small">National Weather Service (weather.gov).</p>`;
  } catch {
    return `<h3>Weather</h3><p class="callout">Forecast unavailable (offline or NWS outage).</p>${astro}`;
  }
}
