/**
 * Settings.
 *
 * Four things only: the passcode, your currencies, backups, and the reset. Every
 * destructive action explains what it destroys before it happens.
 */

import {
  h, card, field, input, button, sheet, confirmDialog, downloadFile, icon,
} from '../ui.js';
import { CURRENCIES, yen, parseAmount } from '../money.js';
import {
  getState, updateSettings, exportBackup, importBackup, wipeEverything,
  setPasscode, removePasscode, changePasscode, lock, toast, daysSinceBackup, cashBalance,
} from '../store.js';
import { ratePasscode, isAvailable } from '../crypto.js';

export function settingsView() {
  const state = getState();
  const s = state.settings;
  const view = h('div.view');

  // ---------------------------------------------------------- the passcode
  view.append(card('Passcode',
    state.encrypted
      ? h('div',
        h('div.status-line',
          h('span.status-dot.is-on'),
          h('span', h('strong', 'Encrypted. '),
            'Your entries are scrambled on this device and only your passcode unscrambles them.')),
        h('div.btn-row', { style: { marginTop: '12px' } },
          button('Change passcode', { onclick: openChangePasscode }),
          button('Turn off', { class: 'btn-ghost', onclick: openRemovePasscode })),
        h('div.btn-row', { style: { marginTop: '8px' } },
          button('Lock now', { class: 'btn-ghost btn-block', onclick: () => lock() })))
      : h('div',
        h('div.status-line',
          h('span.status-dot'),
          h('span', 'Your entries are stored in plain text. Anyone who unlocks this phone and looks '
            + 'could read them.')),
        isAvailable()
          ? h('div.btn-row', { style: { marginTop: '12px' } },
            button('Set a passcode', { class: 'btn-primary btn-block', onclick: openSetPasscode }))
          : h('p.field-hint', { style: { marginTop: '10px' } },
            'Encryption needs a secure connection. It will be available once the app is opened over '
            + 'https, which is how it works when installed from GitHub Pages.'))));

  // ------------------------------------------------------------- currencies
  view.append(card('Currencies',
    h('p.field-hint', { style: { marginBottom: '10px' } },
      'Which currencies you can enter. Everything still totals in yen.'),
    h('div.check-list', ...Object.keys(CURRENCIES).map((code) => h('label.checkbox',
      h('input', {
        type: 'checkbox',
        checked: s.currencies.includes(code),
        disabled: code === 'JPY',
        onchange: async (e) => {
          const next = e.target.checked
            ? [...new Set([...s.currencies, code])]
            : s.currencies.filter((c) => c !== code);
          await updateSettings({ currencies: next.includes('JPY') ? next : ['JPY', ...next] });
        },
      }),
      h('span', `${code} — ${CURRENCIES[code].label}`))))));

  // ------------------------------------------------------- starting balance
  view.append(card('Starting cash',
    h('p.field-hint', { style: { marginBottom: '10px' } },
      'What you had when you began using the app. Everything since then is added and subtracted from it.'),
    field('Starting amount', input({
      type: 'text', inputmode: 'decimal', class: 'input input-money',
      name: 'startingCash', value: s.startingCash || 0,
      onchange: async (e) => {
        await updateSettings({ startingCash: parseAmount(e.target.value) });
        toast('Updated');
      },
    })),
    h('p.field-hint', `Your balance right now is ${yen(cashBalance())}.`)));

  // ----------------------------------------------------------------- backup
  const days = daysSinceBackup();
  view.append(card('Backup',
    h('div.banner.banner-warn', { style: { marginBottom: '12px' } },
      h('span.banner-icon', icon('alert', 18)),
      h('div.banner-body',
        'Your data lives only on this phone. Clearing the browser, switching phone, or losing it means '
        + 'losing everything. A backup is one file you can keep anywhere.',
        h('div', { style: { marginTop: '4px' } },
          days === Infinity
            ? h('strong', 'You have never backed up.')
            : `Last backup: ${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'} ago.`))),

    h('div.btn-row',
      button('Save a backup', {
        class: 'btn-primary',
        onclick: async () => {
          try {
            const backup = await exportBackup();
            downloadFile(`cash-backup-${new Date().toISOString().slice(0, 10)}.json`,
              JSON.stringify(backup, null, 2));
            toast('Backup saved', 'success');
          } catch (err) {
            toast(err.message || 'Could not save', 'error');
          }
        },
      }),
      button('Restore', { onclick: openImport })),

    state.encrypted
      ? h('p.field-hint', { style: { marginTop: '10px' } },
        'The backup file is not encrypted, so it can always be restored. Keep it somewhere private.')
      : null));

  // ------------------------------------------------------------------ reset
  view.append(card('Start over',
    h('p.field-hint', { style: { marginBottom: '10px' } },
      `Deletes all ${state.entries.length} entries and settings from this device. There is no undo.`),
    button('Delete everything', {
      class: 'btn-danger btn-block',
      onclick: async () => {
        const ok = await confirmDialog('Delete everything?',
          `All ${state.entries.length} entries, your starting balance and your passcode will be permanently `
          + 'deleted from this phone. Save a backup first if there is any chance you will want this back.',
          'Delete everything');
        if (!ok) return;
        await wipeEverything();
        toast('Everything deleted');
      },
    })));

  // ------------------------------------------------------------------ about
  view.append(card('About',
    h('p.field-hint',
      'A simple cash book. No account, no server, no tracking — nothing you type leaves this device.'),
    h('p.field-hint', { style: { marginTop: '8px' } },
      'When you start putting money through a bank, or need to file a tax return, there is a fuller version '
      + 'of this app on the ',
      h('code', 'main'),
      ' branch that handles proper bookkeeping and Japanese tax.'),
    field('Appearance', h('select.input', {
      onchange: (e) => {
        const v = e.target.value;
        try { localStorage.setItem('cash-theme', v); } catch { /* private mode */ }
        if (v === 'auto') document.documentElement.removeAttribute('data-theme');
        else document.documentElement.setAttribute('data-theme', v);
      },
    }, ...[
      { v: 'auto', l: 'Match my phone' },
      { v: 'light', l: 'Light' },
      { v: 'dark', l: 'Dark' },
    ].map((o) => h('option', {
      value: o.v,
      selected: (localStorage.getItem('cash-theme') || 'auto') === o.v,
    }, o.l))))));

  return view;
}

// ------------------------------------------------------------ passcode flows

function openSetPasscode() {
  let pass = '';
  let confirm = '';
  const body = h('div');
  const { close } = sheet('Set a passcode', body);

  const strength = h('p.field-hint');
  const update = () => {
    const r = ratePasscode(pass);
    strength.textContent = r.label;
    strength.className = `field-hint strength-${r.level}`;
  };

  body.append(h('div.banner.banner-warn',
    h('span.banner-icon', icon('alert', 18)),
    h('div.banner-body',
      h('strong', 'If you forget this, your data is gone. '),
      'The passcode is not stored anywhere, so nobody — including me — can recover it. '
      + 'Save a backup before you turn this on.')));

  body.append(field('Passcode', input({
    type: 'password', name: 'passcode', autocomplete: 'new-password',
    placeholder: 'A word or phrase you will not forget',
    oninput: (e) => { pass = e.target.value; update(); },
  })));
  body.append(strength);

  body.append(field('Type it again', input({
    type: 'password', name: 'confirm', autocomplete: 'new-password',
    oninput: (e) => { confirm = e.target.value; },
  })));

  body.append(h('div.btn-row', { style: { marginTop: '18px' } },
    button('Cancel', { class: 'btn-ghost', onclick: close }),
    button('Turn on encryption', {
      class: 'btn-primary', name: 'save',
      onclick: async () => {
        const r = ratePasscode(pass);
        if (!r.ok) { toast(r.label || 'Choose a longer passcode', 'error'); return; }
        if (pass !== confirm) { toast('The two do not match', 'error'); return; }
        try {
          await setPasscode(pass);
          toast('Encrypted', 'success');
          close();
        } catch (err) {
          toast(err.message || 'Could not turn on encryption', 'error');
        }
      },
    })));
}

function openChangePasscode() {
  let current = '';
  let next = '';
  const body = h('div');
  const { close } = sheet('Change passcode', body);

  body.append(field('Current passcode', input({
    type: 'password', name: 'current', autocomplete: 'current-password',
    oninput: (e) => { current = e.target.value; },
  })));
  body.append(field('New passcode', input({
    type: 'password', name: 'next', autocomplete: 'new-password',
    oninput: (e) => { next = e.target.value; },
  })));

  body.append(h('div.btn-row', { style: { marginTop: '18px' } },
    button('Cancel', { class: 'btn-ghost', onclick: close }),
    button('Change', {
      class: 'btn-primary', name: 'save',
      onclick: async () => {
        const r = ratePasscode(next);
        if (!r.ok) { toast(r.label || 'Choose a longer passcode', 'error'); return; }
        try {
          await changePasscode(current, next);
          toast('Passcode changed', 'success');
          close();
        } catch (err) {
          toast(err.message || 'Could not change it', 'error');
        }
      },
    })));
}

function openRemovePasscode() {
  let current = '';
  const body = h('div');
  const { close } = sheet('Turn off the passcode', body);

  body.append(h('p.dialog-message',
    'Your entries will go back to being stored in plain text on this device.'));
  body.append(field('Current passcode', input({
    type: 'password', name: 'current', autocomplete: 'current-password',
    oninput: (e) => { current = e.target.value; },
  })));

  body.append(h('div.btn-row', { style: { marginTop: '18px' } },
    button('Cancel', { class: 'btn-ghost', onclick: close }),
    button('Turn off', {
      class: 'btn-danger', name: 'save',
      onclick: async () => {
        try {
          await removePasscode(current);
          toast('Encryption off');
          close();
        } catch (err) {
          toast(err.message || 'Wrong passcode', 'error');
        }
      },
    })));
}

function openImport() {
  const picker = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      const ok = await confirmDialog('Restore this backup?',
        `It holds ${backup.entryCount ?? backup.entries?.length ?? '?'} entries from `
        + `${backup.exportedAt ? new Date(backup.exportedAt).toLocaleDateString() : 'an unknown date'}. `
        + 'Restoring replaces everything currently on this phone.',
        'Restore');
      if (!ok) return;
      const count = await importBackup(backup);
      toast(`Restored ${count} entries`, 'success');
    } catch (err) {
      toast(err.message || 'Could not read that file', 'error');
    } finally {
      picker.remove();
    }
  });
  document.body.append(picker);
  picker.click();
}
