/**
 * DOM helpers and icons.
 *
 * No framework. Three screens that re-render wholesale is less code than any
 * library that could manage them, and it loads instantly on a phone.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** h('div.card', { onclick }, child, 'text') — tag takes .class and #id shorthand. */
export function h(tag, props, ...children) {
  let p = props;
  let kids = children;
  if (p !== null && (typeof p !== 'object' || Array.isArray(p) || p instanceof Node)) {
    kids = [p, ...children];
    p = {};
  }
  p = p || {};

  const id = tag.match(/#([\w-]+)/);
  const classes = (tag.match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
  const el = document.createElement(tag.replace(/[.#][\w-]+/g, '') || 'div');
  if (id) el.id = id[1];
  if (classes.length) el.classList.add(...classes);

  for (const [k, v] of Object.entries(p)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.classList.add(...String(v).split(/\s+/).filter(Boolean));
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && k !== 'list') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
    else el.setAttribute(k, v);
  }

  for (const child of kids.flat(Infinity)) {
    if (child === null || child === undefined || typeof child === 'boolean') continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// -------------------------------------------------------------------- icons

const PATHS = {
  home: 'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 11 4a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 20 11a2 2 0 1 1 0 4z',
  basket: 'M4 9h16l-1.5 11h-13zM8.5 9 12 3l3.5 6M9.5 13v3M14.5 13v3',
  bowl: 'M3 11h18a9 9 0 0 1-18 0zM12 3v4M8.5 4.5v2.5M15.5 4.5v2.5M4 21h16',
  bolt: 'M13 2 4 14h6l-1 8 9-12h-6z',
  train: 'M6 3h12v12H6zM6 15l-2 5M18 15l2 5M9 8h6M9.5 18h5',
  wifi: 'M2.5 9a15 15 0 0 1 19 0M5.5 12.5a10 10 0 0 1 13 0M8.5 16a5.5 5.5 0 0 1 7 0M12 19.5h.01',
  heart: 'M12 20s-7-4.5-7-9.5A4 4 0 0 1 12 8a4 4 0 0 1 7 2.5C19 15.5 12 20 12 20z',
  box: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  shirt: 'M8 3 4 5.5 6 10l1.5-.8V21h9V9.2L18 10l2-4.5L16 3l-2 2h-4z',
  star: 'M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.4l6-.8z',
  send: 'M21 3 3 10.5l7 3 3 7z M10 13.5 21 3',
  key: 'M4 21V3h10v18M14 9h6v12M7 7h4M7 11h4M7 15h4M17 13h1M17 17h1M2 21h20',
  laptop: 'M5 5h14v11H5zM2 19h20M9.5 19v-3h5v3',
  gift: 'M4 11h16v10H4zM3 7h18v4H3zM12 7v14M12 7S10.5 3 8 3a2 2 0 0 0 0 4M12 7s1.5-4 4-4a2 2 0 0 1 0 4',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  check: 'M4 12.5 9 18 20 6',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4M12 15v2',
  down: 'M12 3v12M7 11l5 5 5-5M4 21h16',
  up: 'M12 16V4M7 8l5-5 5 5M4 21h16',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
  wallet: 'M3 7h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a1 1 0 0 1-1-1zM3 7V5a1 1 0 0 1 1-1h12M16.5 13h.01',
  alert: 'M12 3 1.5 21h21zM12 9v5M12 17.5h.01',
  back: 'M15 5l-7 7 7 7',
};

export function icon(name, size = 24) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', PATHS[name] || PATHS.dots);
  svg.append(path);
  return svg;
}

// ----------------------------------------------------------------- controls

export function field(label, input, hint) {
  return h('label.field',
    h('span.field-label', label),
    input,
    hint ? h('span.field-hint', hint) : null);
}

export function input(props = {}) {
  return h('input.input', { type: 'text', ...props });
}

export function select(options, props = {}) {
  const el = h('select.input', props);
  for (const o of options) el.append(h('option', { value: o.value }, o.label));
  if (props.value !== undefined) el.value = String(props.value);
  return el;
}

export function button(label, props = {}) {
  return h('button.btn', { type: 'button', ...props }, label);
}

export function card(title, ...children) {
  return h('section.card', title ? h('h2.card-title', title) : null, ...children);
}

/** Bottom sheet, which is where a phone expects a form to appear. */
export function sheet(title, content, { onClose } = {}) {
  const overlay = h('div.sheet-overlay');
  const close = () => {
    overlay.classList.remove('open');
    setTimeout(() => { overlay.remove(); onClose?.(); }, 180);
  };
  overlay.append(h('div.sheet',
    h('header.sheet-header',
      h('h2', title),
      h('button.sheet-close', { type: 'button', 'aria-label': 'Close', onclick: close }, '×')),
    h('div.sheet-body', content)));

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const esc = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } };
  document.addEventListener('keydown', esc);

  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  return { overlay, close };
}

export function confirmDialog(title, message, confirmLabel = 'Confirm', danger = true) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const { close } = sheet(title, h('div',
      h('p.dialog-message', message),
      h('div.dialog-actions',
        button('Cancel', { class: 'btn-ghost', onclick: () => { done(false); close(); } }),
        button(confirmLabel, {
          class: danger ? 'btn-danger' : 'btn-primary',
          onclick: () => { done(true); close(); },
        }))),
    { onClose: () => done(false) });
  });
}

export function downloadFile(filename, content, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Horizontal proportion bar, used for the spending breakdown. */
export function bar(fraction, tone = 'accent') {
  return h('div.bar', h(`div.bar-fill.tone-${tone}`, {
    style: { width: `${Math.max(1, Math.min(100, fraction * 100))}%` },
  }));
}
