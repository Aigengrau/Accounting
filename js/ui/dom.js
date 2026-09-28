/**
 * Minimal DOM helpers.
 *
 * No framework. The app is a handful of screens whose state lives in the store,
 * so a create-element helper and full re-render per view is simpler to read and
 * faster to load than anything with a virtual DOM. Nothing here is clever.
 */

/**
 * Creates an element.
 *
 * @example h('div.card', { onclick: fn }, h('h2', 'Title'), 'text')
 * The tag accepts `tag.class1.class2#id` shorthand.
 */
export function h(tag, props, ...children) {
  let realProps = props;
  let realChildren = children;

  // Allow h('div', child) with no props object.
  if (props !== null && (typeof props !== 'object' || Array.isArray(props) || props instanceof Node)) {
    realChildren = [props, ...children];
    realProps = {};
  }
  realProps = realProps || {};

  const idMatch = tag.match(/#([\w-]+)/);
  const classes = (tag.match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
  const tagName = tag.replace(/[.#][\w-]+/g, '') || 'div';

  const el = document.createElement(tagName);
  if (idMatch) el.id = idMatch[1];
  if (classes.length) el.classList.add(...classes);

  for (const [key, value] of Object.entries(realProps)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class' || key === 'className') {
      el.classList.add(...String(value).split(/\s+/).filter(Boolean));
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key === 'dataset' && typeof value === 'object') {
      Object.assign(el.dataset, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'html') {
      el.innerHTML = value;
    } else if (key in el && key !== 'list' && key !== 'form') {
      try { el[key] = value; } catch { el.setAttribute(key, value); }
    } else {
      el.setAttribute(key, value);
    }
  }

  append(el, realChildren);
  return el;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Text with the Japanese term underneath, used all over the app. */
export function bilingual(en, ja, showJa = true) {
  return h('span.bi', h('span.bi-en', en), showJa && ja ? h('span.bi-ja', ja) : null);
}

/** A labelled form field. */
export function field(label, input, hint) {
  return h('label.field',
    h('span.field-label', label),
    input,
    hint ? h('span.field-hint', hint) : null);
}

export function input(props = {}) {
  return h('input.input', { type: 'text', ...props });
}

export function moneyInput(props = {}) {
  return h('input.input.input-money', {
    type: 'text', inputmode: 'decimal', autocomplete: 'off', ...props,
  });
}

export function select(options, props = {}) {
  const el = h('select.input', props);
  for (const opt of options) {
    el.append(h('option', {
      value: opt.value,
      selected: String(opt.value) === String(props.value),
    }, opt.label));
  }
  // Setting .value after the options exist is what actually applies the selection.
  if (props.value !== undefined) el.value = String(props.value);
  return el;
}

export function checkbox(label, props = {}) {
  return h('label.checkbox',
    h('input', { type: 'checkbox', ...props }),
    h('span', label));
}

export function button(label, props = {}) {
  return h('button.btn', { type: 'button', ...props }, label);
}

/** A card with a heading. */
export function card(title, ...children) {
  return h('section.card',
    title ? h('h2.card-title', title) : null,
    ...children);
}

/** Keeps long numbers readable and consistently right-aligned. */
export function amountCell(amount, opts = {}) {
  const n = Math.round(Number(amount) || 0);
  const cls = ['amount'];
  if (n < 0) cls.push('negative');
  if (opts.total) cls.push('is-total');
  if (opts.subtotal) cls.push('is-subtotal');
  return h(`span.${cls.join('.')}`, `¥${n.toLocaleString('en-US')}`);
}

/** Row of a derivation table: label on the left, amount on the right. */
export function derivationRow(line) {
  if (line.note) return h('div.deriv-row.deriv-note', h('span.deriv-label', line.label));
  return h(`div.deriv-row${line.total ? '.is-total' : ''}${line.subtotal ? '.is-subtotal' : ''}`,
    h('span.deriv-label',
      line.label,
      line.ja ? h('span.deriv-ja', line.ja) : null),
    amountCell(line.amount, line));
}

/** Parses a money field, tolerating commas, yen signs and full-width digits. */
export function parseMoney(value) {
  if (value === null || value === undefined) return 0;
  const normalised = String(value)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,\s¥￥$₽€£]/g, '');
  const n = Number(normalised);
  return Number.isFinite(n) ? n : 0;
}

export function todayIso() {
  const d = new Date();
  const tzOffset = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
}

/** A severity pill. */
export function badge(text, kind = 'neutral') {
  return h(`span.badge.badge-${kind}`, text);
}

/** Collapsible section, collapsed by default. */
export function details(summary, ...children) {
  return h('details.disclosure', h('summary', summary), h('div.disclosure-body', ...children));
}

/** Modal sheet that slides up from the bottom, which suits a phone. */
export function sheet(title, content, { onClose } = {}) {
  const overlay = h('div.sheet-overlay');
  const close = () => {
    overlay.classList.add('closing');
    setTimeout(() => { overlay.remove(); onClose?.(); }, 180);
  };
  const panel = h('div.sheet',
    h('header.sheet-header',
      h('h2', title),
      h('button.sheet-close', { type: 'button', 'aria-label': 'Close', onclick: close }, '×')),
    h('div.sheet-body', content));
  overlay.append(panel);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  return { overlay, panel, close };
}

/** Confirmation dialog. Resolves true only on explicit confirm. */
export function confirmDialog(title, message, confirmLabel = 'Confirm') {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    const { close } = sheet(title,
      h('div',
        h('p.dialog-message', message),
        h('div.dialog-actions',
          button('Cancel', { class: 'btn-ghost', onclick: () => { finish(false); close(); } }),
          button(confirmLabel, { class: 'btn-danger', onclick: () => { finish(true); close(); } }))),
      { onClose: () => finish(false) });
  });
}

/** Triggers a file download from a string. */
export function downloadFile(filename, content, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
