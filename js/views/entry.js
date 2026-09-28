/**
 * Adding money in and out.
 *
 * Optimised for the one moment that matters: standing in a shop with the receipt
 * in your hand. Amount first, category as a tap, save. Everything else has a
 * sensible default.
 */

import { h, sheet, field, input, select, button, icon, confirmDialog } from '../ui.js';
import { CURRENCIES, parseAmount, yen, today, formatCurrency, fetchRate } from '../money.js';
import { categoriesFor, category } from '../categories.js';
import { getState, saveEntry, deleteEntry, toast } from '../store.js';

/** Opens the add sheet. `type` is 'expense' or 'income'. */
export function openAdd(type = 'expense') {
  openForm({ type });
}

export function openEdit(entry) {
  openForm({ ...entry, editing: true });
}

function openForm(initial) {
  const settings = getState().settings;
  const isIncome = initial.type === 'income';

  const draft = {
    id: initial.id,
    type: initial.type,
    amount: initial.amount ?? '',
    currency: initial.currency || 'JPY',
    jpy: initial.jpy ?? '',
    date: initial.date || today(),
    category: initial.category || (isIncome ? 'freelance' : 'groceries'),
    note: initial.note || '',
  };

  const body = h('div');
  const { close } = sheet(
    initial.editing ? 'Edit entry' : isIncome ? 'Money in' : 'Money out',
    body,
  );

  const render = () => {
    body.replaceChildren();

    // ------------------------------------------------------------- amount
    const amountInput = h('input.input.amount-input', {
      type: 'text', inputmode: 'decimal', name: 'amount',
      value: draft.amount, placeholder: '0',
      autocomplete: 'off',
      oninput: (e) => { draft.amount = e.target.value; updateYen(); },
    });

    const currencies = (settings.currencies || ['JPY']).map((c) => ({
      value: c, label: c,
    }));

    body.append(h('div.amount-row',
      amountInput,
      currencies.length > 1
        ? h('select.input.currency-select', {
            name: 'currency',
            onchange: (e) => { draft.currency = e.target.value; render(); },
          }, ...currencies.map((c) => h('option', {
            value: c.value, selected: c.value === draft.currency,
          }, c.label)))
        : h('span.currency-fixed', 'JPY')));

    // ------------------------------------------ yen value, if not already yen
    const yenNote = h('p.field-hint');
    const updateYen = () => {
      if (draft.currency === 'JPY') { yenNote.textContent = ''; return; }
      const j = parseAmount(draft.jpy);
      const a = parseAmount(draft.amount);
      yenNote.textContent = j && a
        ? `That works out at ${(j / a).toFixed(2)} yen per ${draft.currency}.`
        : 'Enter the yen you actually got, so your balance stays accurate.';
    };

    if (draft.currency !== 'JPY') {
      const jpyInput = h('input.input.input-money', {
        type: 'text', inputmode: 'decimal', name: 'jpy',
        value: draft.jpy, placeholder: '0',
        oninput: (e) => { draft.jpy = e.target.value; updateYen(); },
      });

      body.append(h('div.field',
        h('span.field-label', 'How many yen did you get?'),
        jpyInput,
        yenNote,
        h('div.btn-row', { style: { marginTop: '8px' } },
          button('Use today’s rate', {
            class: 'btn-sm btn-ghost',
            onclick: async (e) => {
              const a = parseAmount(draft.amount);
              if (!a) { toast('Enter an amount first'); return; }
              e.target.disabled = true;
              e.target.textContent = 'Checking…';
              const rate = await fetchRate(draft.currency);
              e.target.disabled = false;
              e.target.textContent = 'Use today’s rate';
              if (rate) {
                draft.jpy = String(Math.round(a * rate));
                jpyInput.value = draft.jpy;
                updateYen();
                toast(`Approximate: ${rate.toFixed(2)} yen per ${draft.currency}`);
              } else {
                toast('No connection — type the amount yourself', 'error');
              }
            },
          }))));
      updateYen();
    }

    // ----------------------------------------------------------- categories
    const cats = categoriesFor(draft.type);
    body.append(h('div.field',
      h('span.field-label', isIncome ? 'Where did it come from?' : 'What was it for?'),
      h('div.cat-grid', ...cats.map((c) => h('button.cat-tile', {
        type: 'button',
        class: draft.category === c.id ? 'is-selected' : '',
        onclick: () => { draft.category = c.id; render(); },
      }, icon(c.icon, 20), h('span', c.label))))));

    const chosen = category(draft.category);
    if (chosen.note) body.append(h('p.field-hint', { style: { marginTop: '-6px' } }, chosen.note));

    // ---------------------------------------------------------- date, note
    body.append(h('div.field-row',
      field('Date', input({
        type: 'date', name: 'date', value: draft.date,
        onchange: (e) => { draft.date = e.target.value; },
      })),
      field('Note (optional)', input({
        name: 'note', value: draft.note, placeholder: 'e.g. Lawson',
        oninput: (e) => { draft.note = e.target.value; },
      }))));

    // ---------------------------------------------------------------- save
    body.append(h('div.btn-row', { style: { marginTop: '18px' } },
      initial.editing
        ? button('Delete', {
            class: 'btn-danger',
            onclick: async () => {
              const ok = await confirmDialog('Delete this entry?',
                'It will be removed and your balance will change. This cannot be undone.', 'Delete');
              if (!ok) return;
              await deleteEntry(draft.id);
              toast('Deleted');
              close();
            },
          })
        : button('Cancel', { class: 'btn-ghost', onclick: close }),
      button(initial.editing ? 'Save' : isIncome ? 'Add money in' : 'Add money out', {
        class: 'btn-primary', name: 'save',
        onclick: async () => {
          const amount = parseAmount(draft.amount);
          if (!amount) { toast('Enter an amount', 'error'); return; }
          if (draft.currency !== 'JPY' && !parseAmount(draft.jpy)) {
            toast('Enter how many yen you got', 'error');
            return;
          }
          try {
            await saveEntry({
              ...draft,
              amount,
              jpy: draft.currency === 'JPY' ? amount : parseAmount(draft.jpy),
            });
            toast(initial.editing ? 'Saved' : isIncome ? 'Money in recorded' : 'Recorded', 'success');
            close();
          } catch (err) {
            toast(err.message || 'Could not save', 'error');
          }
        },
      })));
  };

  render();
  // Focus the amount so the keypad opens straight away.
  requestAnimationFrame(() => body.querySelector('.amount-input')?.focus());
}

/** Short one-line description of an entry, used in lists. */
export function describe(entry) {
  if (entry.note) return entry.note;
  return category(entry.category).label;
}

/** Secondary line: category, and the original currency when it was not yen. */
export function subtitle(entry) {
  const parts = [category(entry.category).label];
  if (entry.currency !== 'JPY') {
    parts.push(formatCurrency(entry.amount, entry.currency));
  }
  return parts.join(' · ');
}
