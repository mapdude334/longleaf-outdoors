export type SheetSnap = 'peek' | 'half' | 'full';

export function isCompactLayout() {
  return innerWidth <= 900 || innerHeight <= 600;
}

export function setSheetSnap(snap: SheetSnap) {
  const sheet = document.getElementById('sheet');
  const handle = document.getElementById('grab');
  const hint = document.getElementById('grab-hint');
  if (!sheet || !handle || !hint) return;
  sheet.classList.toggle('open', snap !== 'peek');
  sheet.classList.toggle('half', snap === 'half');
  sheet.dataset.snap = snap;
  handle.setAttribute('aria-expanded', String(snap !== 'peek'));
  handle.setAttribute('aria-label', snap === 'peek' ? 'Expand panel to show destination details' : snap === 'half' ? 'Expand panel or swipe down to show more map' : 'Collapse panel to show the map');
  hint.textContent = snap === 'peek'
    ? `${sheet.dataset.destination || 'Choose a lake'} · swipe up for details`
    : snap === 'half' ? 'Swipe up for more · down for map' : 'Swipe down to show map';
}
