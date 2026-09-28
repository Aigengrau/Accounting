/**
 * Application shell: boot, routing, and the render loop.
 *
 * Routing is hash-based so the app works from any sub-path on GitHub Pages
 * without server rewrites, and so the phone's back button behaves.
 */

import { h, clear, $ } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { initStore, subscribe, getState, setView, setTaxYear } from './store.js';
import { invalidate } from './derive.js';
import { SUPPORTED_YEARS } from './tax/rates.js';
import { dashboardView } from './views/dashboard.js';
import { transactionsView } from './views/transactions.js';
import { taxView } from './views/tax.js';
import { advisorView } from './views/advisor.js';
import { reportsView } from './views/reports.js';
import { calendarView } from './views/calendar.js';
import { settingsView } from './views/settings.js';
import { openQuickAdd } from './views/entry.js';

const ROUTES = {
  dashboard: { label: 'Home', icon: 'home', render: dashboardView, nav: true },
  transactions: { label: 'Entries', icon: 'list', render: transactionsView, nav: true },
  tax: { label: 'Tax', icon: 'calculator', render: taxView, nav: true },
  advisor: { label: 'Advice', icon: 'lightbulb', render: advisorView, nav: true },
  reports: { label: 'Books', icon: 'book', render: reportsView, nav: true },
  calendar: { label: 'Calendar', icon: 'calendar', render: calendarView },
  settings: { label: 'Settings', icon: 'settings', render: settingsView },
};

const NAV_ORDER = Object.keys(ROUTES).filter((k) => ROUTES[k].nav);

let root;
let header;
let nav;
let rendering = false;

async function boot() {
  applyStoredTheme();

  root = $('#app');
  header = $('#header');
  nav = $('#nav');

  try {
    await initStore();
  } catch (err) {
    root.replaceChildren(h('div.view', h('div.banner.banner-critical',
      h('span.banner-icon', '⚠'),
      h('div.banner-body',
        h('strong', 'Could not open local storage. '),
        err.message,
        ' Private browsing windows and blocked site data both prevent the app from saving anything.'))));
    return;
  }

  // Route from the hash, then keep them in sync.
  const fromHash = location.hash.replace(/^#\/?/, '');
  if (ROUTES[fromHash]) setView(fromHash);

  window.addEventListener('hashchange', () => {
    const view = location.hash.replace(/^#\/?/, '');
    if (ROUTES[view] && view !== getState().ui.view) setView(view);
  });

  subscribe(() => {
    invalidate();
    render();
  });

  render();
  registerServiceWorker();
}

function render() {
  if (rendering) return;
  rendering = true;
  requestAnimationFrame(() => {
    rendering = false;
    const state = getState();
    const route = ROUTES[state.ui.view] || ROUTES.dashboard;

    if (location.hash.replace(/^#\/?/, '') !== state.ui.view) {
      history.replaceState(null, '', `#/${state.ui.view}`);
    }

    renderHeader(state, route);
    renderNav(state);

    clear(root);
    try {
      root.append(route.render());
    } catch (err) {
      console.error(err);
      root.append(h('div.view', h('div.banner.banner-critical',
        h('span.banner-icon', '⚠'),
        h('div.banner-body',
          h('strong', 'Something went wrong rendering this screen. '),
          err.message,
          h('div.banner-actions',
            h('button.btn.btn-sm', { onclick: () => setView('dashboard') }, 'Back to home'))))));
    }

    renderToast(state);
    root.scrollIntoView({ block: 'start', behavior: 'auto' });
  });
}

function renderHeader(state, route) {
  clear(header);
  header.append(h('div.app-header-inner',
    h('h1.app-title',
      h('span.app-title-mark', '青'),
      h('span', route.label === 'Home' ? 'Aoiro' : route.label)),
    h('select.year-select', {
      'aria-label': 'Tax year',
      onchange: (e) => setTaxYear(Number(e.target.value)),
    }, ...SUPPORTED_YEARS.map((y) => h('option', {
      value: y, selected: y === state.taxYear,
    }, String(y)))),
    h('button.nav-item', {
      style: { width: '38px', flex: 'none' },
      'aria-label': 'Calendar',
      class: state.ui.view === 'calendar' ? 'is-active' : '',
      onclick: () => setView('calendar'),
    }, icon('calendar', { size: 20 })),
    h('button.nav-item', {
      style: { width: '38px', flex: 'none' },
      'aria-label': 'Settings',
      class: state.ui.view === 'settings' ? 'is-active' : '',
      onclick: () => setView('settings'),
    }, icon('settings', { size: 20 }))));
}

function renderNav(state) {
  clear(nav);
  nav.append(h('div.nav-inner', ...NAV_ORDER.map((key) => {
    const r = ROUTES[key];
    return h('button.nav-item', {
      class: state.ui.view === key ? 'is-active' : '',
      'aria-current': state.ui.view === key ? 'page' : null,
      onclick: () => setView(key),
    }, icon(r.icon, { size: 21 }), h('span', r.label));
  })));

  // The add button belongs to the entries screen and the dashboard.
  const existing = $('.fab');
  if (existing) existing.remove();
  if (state.ui.view === 'dashboard' || state.ui.view === 'transactions') {
    document.body.append(h('button.fab', {
      'aria-label': 'Add an entry',
      onclick: openQuickAdd,
    }, '+'));
  }
}

let toastEl = null;
function renderToast(state) {
  const t = state.ui.toast;
  if (toastEl) { toastEl.remove(); toastEl = null; }
  if (!t) return;
  toastEl = h(`div.toast${t.kind === 'error' ? '.is-error' : t.kind === 'success' ? '.is-success' : ''}`,
    { role: 'status' }, t.message);
  document.body.append(toastEl);
}

function applyStoredTheme() {
  try {
    const stored = localStorage.getItem('aoiro-theme');
    if (stored === 'light' || stored === 'dark') {
      document.documentElement.setAttribute('data-theme', stored);
    }
  } catch {
    // Private mode blocks localStorage; the OS preference still applies.
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Registered relative to the page so it works from a GitHub Pages sub-path.
  navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: './' })
    .catch((err) => console.warn('Service worker registration failed:', err));
}

boot();
