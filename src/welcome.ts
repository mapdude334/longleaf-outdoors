import { storageKey } from './environment';
const EDITION = '2026-10-26.2';
const KEY = storageKey('vw:acknowledgment');

export function initWelcome() {
  const dialog = document.querySelector<HTMLDialogElement>('#welcome')!;
  const remember = document.querySelector<HTMLInputElement>('#welcome-remember')!;
  const open = () => {
    if (!dialog.open) {
      dialog.showModal();
      dialog.scrollTop = 0;
      // Start at the heading; keyboard users can reach links and the action naturally.
      const heading = document.querySelector<HTMLElement>('#welcome-title')!;
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  };
  document.querySelector<HTMLButtonElement>('#about-longleaf')!.onclick = open;
  document.querySelector<HTMLButtonElement>('#welcome-continue')!.onclick = () => {
    try {
      sessionStorage.setItem(KEY, EDITION);
      if (remember.checked) localStorage.setItem(KEY, EDITION);
      else localStorage.removeItem(KEY);
    } catch { /* The notice still works when browser storage is unavailable. */ }
    dialog.close();
  };
  let acknowledged = false;
  try {
    remember.checked = localStorage.getItem(KEY) === EDITION;
    acknowledged = remember.checked || sessionStorage.getItem(KEY) === EDITION;
  } catch { /* Show the notice in storage-restricted browsers. */ }
  if (!acknowledged) open();
}
