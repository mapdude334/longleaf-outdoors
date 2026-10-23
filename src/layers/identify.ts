// Click-to-identify against live ArcGIS services (used when the offline vector overlays
// aren't installed, or to get full parcel attributes).
import { ARCGIS } from '../config';
import { esc, fetchJSON, propsTable } from '../util';

async function queryPoint(service: string, layer: number, lng: number, lat: number) {
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`, geometryType: 'esriGeometryPoint', inSR: '4326', spatialRel: 'esriSpatialRelIntersects',
    outFields: '*', returnGeometry: 'false', f: 'json',
  });
  const j = await fetchJSON<any>(`${service}/${layer}/query?${params}`, { timeout: 12000 });
  return (j.features ?? []).map((f: any) => f.attributes as Record<string, unknown>);
}

export const MANAGER_TYPES: Record<string, string> = {
  FED: 'Federal', STAT: 'State', LOC: 'Local government', NGO: 'Non-profit', PVT: 'Private', JNT: 'Joint', DIST: 'Regional district', TRIB: 'Tribal', UNK: 'Unknown',
};
export const ACCESS_TYPES: Record<string, string> = { OA: 'Open access', RA: 'Restricted access', XA: 'Closed to public', UK: 'Unknown access' };

export function publicLandHtml(p: Record<string, any>): string {
  const name = p.Unit_Nm || p.Loc_Nm || 'Protected area';
  const acc = ACCESS_TYPES[p.Pub_Access] ?? p.Pub_Access ?? '';
  return `<div class="pl"><h3>${esc(name)}</h3>
    <p><strong>${esc(acc)}</strong>${p.Des_Tp ? ` · ${esc(p.Des_Tp)}` : ''}</p>
    <table class="props">
      <tr><th>Manager</th><td>${esc(p.Mang_Name ?? '')} (${esc(MANAGER_TYPES[p.Mang_Type] ?? p.Mang_Type ?? '')})</td></tr>
      <tr><th>Owner</th><td>${esc(p.Own_Name ?? '')}</td></tr>
      ${p.GIS_Acres ? `<tr><th>Acres</th><td>${Number(p.GIS_Acres).toLocaleString()}</td></tr>` : ''}
      ${p.Category ? `<tr><th>Category</th><td>${esc(p.Category)}</td></tr>` : ''}
    </table>
    <p class="muted small">PAD-US is a planning dataset — boundaries and access can be out of date. Check WMA/state park rules, seasons and permits.</p></div>`;
}

export async function identifyPublicLands(lng: number, lat: number): Promise<string | null> {
  try {
    const rows = await queryPoint(ARCGIS.padus.service, ARCGIS.padus.layer, lng, lat);
    return rows.length ? rows.slice(0, 3).map(publicLandHtml).join('<hr>') : null;
  } catch {
    return null;
  }
}

export async function identifyParcels(lng: number, lat: number): Promise<string | null> {
  for (const p of ARCGIS.parcels) {
    try {
      const rows = await queryPoint(p.service, p.layer, lng, lat);
      if (rows.length) return `<h3>Parcel</h3><p class="muted">${esc(p.label)} GIS</p>${propsTable(rows[0])}
        <p class="muted small">Parcel lines are approximate and not a survey. Public parcel data is not permission to enter — get landowner permission.</p>`;
    } catch { /* try next county */ }
  }
  return null;
}
