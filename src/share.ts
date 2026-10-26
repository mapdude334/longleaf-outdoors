import type { Map } from 'maplibre-gl';

export function addShareControl(map: Map) {
  const url = new URL(import.meta.env.BASE_URL, location.origin).href;
  const dialog = document.createElement('dialog');
  dialog.className = 'share-dialog';
  dialog.setAttribute('aria-labelledby', 'share-title');
  dialog.innerHTML = `<h2 id="share-title">Share Longleaf Atlas</h2>
    <p>Send someone the app’s home link.</p>
    <label class="field">Website link<input id="share-url" type="url" readonly></label>
    <div class="row-btns"><button class="btn primary" data-copy-link>Copy link</button><button class="btn" data-device-share>More sharing options</button></div>
    <p class="small muted" role="status" aria-live="polite" data-share-status></p>
    <button class="btn" data-close-share>Close</button>`;
  const input = dialog.querySelector<HTMLInputElement>('#share-url')!;
  input.value = url;
  const status = dialog.querySelector<HTMLElement>('[data-share-status]')!;
  dialog.querySelector<HTMLButtonElement>('[data-copy-link]')!.onclick = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      status.textContent = 'Website link copied to clipboard.';
    } catch {
      input.focus(); input.select();
      status.textContent = 'Automatic copying is unavailable. Copy the selected website link above.';
    }
  };
  const deviceShare = dialog.querySelector<HTMLButtonElement>('[data-device-share]')!;
  deviceShare.hidden = typeof navigator.share !== 'function';
  deviceShare.onclick = async () => {
    try {
      await navigator.share({ title: 'Longleaf Atlas', text: 'Spatially Driven Recreation', url });
      status.textContent = 'Sharing options closed.';
    } catch (error) {
      status.textContent = (error as Error).name === 'AbortError' ? 'Sharing canceled. You can still copy the link.' : 'Device sharing is unavailable. Use Copy link instead.';
    }
  };
  dialog.querySelector<HTMLButtonElement>('[data-close-share]')!.onclick = () => dialog.close();
  document.body.append(dialog);
  let control: HTMLDivElement;
  map.addControl({
    onAdd() {
      control = document.createElement('div');
      control.className = 'maplibregl-ctrl maplibregl-ctrl-group';
      const button = document.createElement('button');
      button.type = 'button'; button.title = 'Share Longleaf Atlas';
      button.setAttribute('aria-label', 'Share Longleaf Atlas');
      button.setAttribute('aria-haspopup', 'dialog');
      button.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style="display:block;margin:auto;fill:none;stroke:currentColor;stroke-width:1.8"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/></svg>';
      button.onclick = () => { status.textContent = ''; dialog.showModal(); };
      dialog.addEventListener('close', () => button.focus({ preventScroll: true }));
      control.append(button);
      return control;
    },
    onRemove() { control.remove(); dialog.remove(); },
  }, 'top-right');
}
