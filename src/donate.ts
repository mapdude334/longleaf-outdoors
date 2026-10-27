// Set this to the owner's Venmo username (without the @) before publishing.
const VENMO_USERNAME = '@James-Bush-4';

export function initDonations() {
  const dialog = document.querySelector<HTMLDialogElement>('#donate-prompt');
  if (!dialog) return;

  const payLink = document.querySelector<HTMLAnchorElement>('#venmo-pay');
  const recipient = document.querySelector<HTMLElement>('#donate-recipient');
  const username = VENMO_USERNAME.trim().replace(/^@/, '');
  if (username && payLink) {
    payLink.href = `https://venmo.com/${encodeURIComponent(username)}`;
    payLink.hidden = false;
    if (recipient) recipient.textContent = `Venmo recipient: @${username}`;
  } else if (recipient) {
    recipient.textContent = 'Venmo payments will be available here once the account is connected.';
  }

  const open = () => {
    if (!dialog.open) dialog.showModal();
  };
  document.querySelector<HTMLButtonElement>('#donate-header')?.addEventListener('click', open);
  document.querySelector<HTMLButtonElement>('#donate-splash')?.addEventListener('click', open);
  document.querySelector<HTMLButtonElement>('#donate-close')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}
