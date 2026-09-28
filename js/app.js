/**
 * App shell: boot, the lock screen, navigation, and the render loop.
 */

import { h, clear, $, icon, button, field, input } from './ui.js';
import { init, subscribe, getState, setView, unlock, toast } from './store.js';
import { homeView } from './views/home.js';
import { historyView } from './views/history.js';
import { settingsView } from './views/settings.js';
import { openAdd } from './views/entry.js';

const ROUTES = {
  home: { label: 'Home', icon: 'home', render: homeView },
  history: { label: 'History', icon: 'list', render: historyView },
  settings: { label: 'Settings', icon: 'settings', render: settingsView },
};

let root;
let nav;
let header;
let pending = false;

async function boot() {
  applyTheme();
  root = $('#app');
  nav = $('#nav');
  header = $('#header');

  try {
    await init();
  } catch (err) {
    clear(root);
    root.append(h('div.view', h('div.banner.banner-bad',
      h('span.banner-icon', icon('alert', 18)),
      h('div.banner-body',
        h('strong', 'Cannot store data on this device. '), err.message,
        ' A private browsing window will do this, because it blocks storage.'))));
    return;
  }

  const fromHash = location.hash.replace(/^#\/?/, '');
  if (ROUTES[fromHash]) setView(fromHash);
  window.addEventListener('hashchange', () => {
    const v = location.hash.replace(/^#\/?/, '');
    if (ROUTES[v] && v !== getState().view) setView(v);
  });

  subscribe(render);
  render();
  registerServiceWorker();
}

function render() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    const state = getState();

    if (state.locked) {
      renderLockScreen();
      return;
    }

    const route = ROUTES[state.view] || ROUTES.home;
    if (location.hash.replace(/^#\/?/, '') !== state.view) {
      history.replaceState(null, '', `#/${state.view}`);
    }

    header.hidden = false;
    nav.hidden = false;
    clear(header).append(h('div.header-inner',
      h('h1.app-name', route.label),
      state.encrypted
        ? h('span.lock-badge', { title: 'Your data is encrypted' }, icon('lock', 15))
        : null));

    clear(root);
    try {
      root.append(route.render());
    } catch (err) {
      console.error(err);
      root.append(h('div.view', h('div.banner.banner-bad',
        h('span.banner-icon', icon('alert', 18)),
        h('div.banner-body', h('strong', 'Something broke. '), err.message))));
    }

    renderNav(state);
    renderToast(state);
    window.scrollTo(0, 0);
  });
}

function renderNav(state) {
  clear(nav).append(h('div.nav-inner',
    ...Object.entries(ROUTES).map(([key, r]) => h('button.nav-item', {
      class: state.view === key ? 'is-active' : '',
      'aria-current': state.view === key ? 'page' : null,
      onclick: () => setView(key),
    }, icon(r.icon, 22), h('span', r.label)))));

  // Two add buttons, because "money out" and "money in" are the whole app.
  $('.fab-group')?.remove();
  if (state.view === 'home' || state.view === 'history') {
    document.body.append(h('div.fab-group',
      h('button.fab.fab-in', {
        'aria-label': 'Add money in',
        onclick: () => openAdd('income'),
      }, icon('up', 20)),
      h('button.fab.fab-out', {
        'aria-label': 'Add money out',
        onclick: () => openAdd('expense'),
      }, icon('plus', 26))));
  }
}

/** Shown when a passcode is set and the app has not been unlocked yet. */
function renderLockScreen() {
  header.hidden = true;
  nav.hidden = true;
  $('.fab-group')?.remove();

  let passcode = '';
  const error = h('p.lock-error');

  const attempt = async (btn) => {
    if (!passcode) return;
    btn.disabled = true;
    btn.textContent = 'Unlocking…';
    error.textContent = '';
    try {
      await unlock(passcode);
    } catch (err) {
      error.textContent = err.message || 'Wrong passcode.';
      btn.disabled = false;
      btn.textContent = 'Unlock';
      const box = $('.lock-input');
      if (box) { box.value = ''; box.focus(); }
      passcode = '';
    }
  };

  const unlockBtn = button('Unlock', {
    class: 'btn-primary btn-block', name: 'unlock',
    onclick: (e) => attempt(e.target),
  });

  const box = h('input.input.lock-input', {
    type: 'password', name: 'passcode', autocomplete: 'current-password',
    placeholder: 'Passcode', 'aria-label': 'Passcode',
    oninput: (e) => { passcode = e.target.value; },
    onkeydown: (e) => { if (e.key === 'Enter') attempt(unlockBtn); },
  });

  clear(root);
  root.append(h('div.lock-screen',
    h('div.lock-icon', icon('lock', 30)),
    h('h1', 'Locked'),
    h('p', 'Enter your passcode to open your cash book.'),
    box,
    error,
    unlockBtn,
    h('p.field-hint', { style: { marginTop: '18px' } },
      'There is no way to reset this. The passcode is not stored anywhere, which is what keeps your data '
      + 'private.')));

  requestAnimationFrame(() => box.focus());
}

let toastEl = null;
function renderToast(state) {
  toastEl?.remove();
  toastEl = null;
  if (!state.toast) return;
  toastEl = h(`div.toast${state.toast.kind === 'error' ? '.is-error' : state.toast.kind === 'success' ? '.is-success' : ''}`,
    { role: 'status' }, state.toast.message);
  document.body.append(toastEl);
}

function applyTheme() {
  try {
    const t = localStorage.getItem('cash-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch { /* private mode blocks localStorage; the OS preference still applies */ }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: './' })
    .catch((err) => console.warn('Service worker did not register:', err));
}

boot();
