/**
 * Inline SVG charts.
 *
 * Hand-built rather than pulled from a library, because the whole app has to work
 * offline from a service-worker cache and a charting bundle would dwarf
 * everything else here.
 *
 * Colour roles come from CSS custom properties so light and dark are two
 * selected palettes rather than an automatic inversion. The two series hues
 * (blue for taxes, orange for social insurance) were validated for colour-vision
 * deficiency separation and contrast against both surfaces.
 *
 * Every chart ships a table view, and every mark has a hover tooltip, so no value
 * is reachable only by eye.
 */

import { h } from './dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const yen = (n) => `¥${Math.round(Number(n) || 0).toLocaleString('en-US')}`;

/** Rounds an axis maximum up to a clean number. */
function niceMax(value) {
  if (value <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    if (value <= mag * step) return mag * step;
  }
  return mag * 10;
}

/** Compact axis labels: 1.2M, 450k. */
function compact(n) {
  const v = Math.abs(n);
  if (v >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}億`;
  if (v >= 1_000_000) return `${(n / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
}

/**
 * A rounded-at-one-end bar path: square where it meets the baseline, 4px rounded
 * at the data end, per the mark spec.
 */
function barPath(x, y, w, hgt, radius, orientation) {
  const r = Math.max(0, Math.min(radius, orientation === 'horizontal' ? w : hgt, orientation === 'horizontal' ? hgt / 2 : w / 2));
  if (orientation === 'horizontal') {
    // Grows left → right; rounded on the right edge.
    return `M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + hgt - r} `
         + `Q${x + w},${y + hgt} ${x + w - r},${y + hgt} H${x} Z`;
  }
  // Grows bottom → top; rounded on the top edge.
  return `M${x},${y + hgt} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} `
       + `Q${x + w},${y} ${x + w},${y + r} V${y + hgt} Z`;
}

/** Shared tooltip, positioned against the chart container. */
function attachTooltip(container) {
  const tip = h('div.chart-tooltip', { role: 'status', 'aria-live': 'polite' });
  container.append(tip);
  let hideTimer = null;

  const show = (html, x, y) => {
    clearTimeout(hideTimer);
    tip.innerHTML = html;
    tip.classList.add('visible');
    const box = container.getBoundingClientRect();
    const tipBox = tip.getBoundingClientRect();
    let left = x - tipBox.width / 2;
    left = Math.max(4, Math.min(left, box.width - tipBox.width - 4));
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(4, y - tipBox.height - 10)}px`;
  };
  const hide = () => {
    hideTimer = setTimeout(() => tip.classList.remove('visible'), 80);
  };
  return { show, hide };
}

/**
 * Ranked horizontal bars.
 *
 * Used for the tax burden breakdown. Two series — taxes and social insurance —
 * because that distinction actually matters: one is tax on profit, the other is a
 * premium you pay whatever your profit. Position carries magnitude, colour
 * carries the group, and every bar is directly labelled.
 */
export function rankedBars(data, { title, height, tableLabel = 'Show figures' } = {}) {
  const rows = [...data].filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  if (rows.length === 0) {
    return h('div.chart-empty', 'Nothing to show yet.');
  }

  const barThickness = Math.min(24, Math.max(14, Math.floor(220 / rows.length)));
  const gap = 10; // comfortably above the 2px minimum, since these are separate categories
  const rowHeight = barThickness + gap;
  const labelWidth = 116;
  const valueWidth = 82;
  const padding = { top: 4, right: valueWidth, bottom: 22, left: labelWidth };
  const plotWidth = 360 - padding.left - padding.right;
  const plotHeight = rows.length * rowHeight;
  const totalHeight = height || plotHeight + padding.top + padding.bottom;
  const max = niceMax(Math.max(...rows.map((d) => d.value)));

  const container = h('figure.chart', { role: 'group', 'aria-label': title || 'Chart' });
  const svg = svgEl('svg', {
    viewBox: `0 0 360 ${totalHeight}`,
    class: 'chart-svg',
    preserveAspectRatio: 'xMinYMin meet',
    role: 'img',
    'aria-label': `${title || 'Chart'}: ${rows.map((r) => `${r.label} ${yen(r.value)}`).join(', ')}`,
  });

  // Recessive gridlines at 0, half, max.
  for (const frac of [0, 0.5, 1]) {
    const x = padding.left + plotWidth * frac;
    svg.append(svgEl('line', {
      x1: x, y1: padding.top, x2: x, y2: padding.top + plotHeight,
      class: frac === 0 ? 'chart-baseline' : 'chart-gridline',
    }));
    svg.append(svgEl('text', {
      x, y: totalHeight - 7, class: 'chart-tick', 'text-anchor': frac === 1 ? 'end' : 'middle',
    }, compact(max * frac)));
  }

  const tooltip = attachTooltip(container);

  rows.forEach((row, i) => {
    const y = padding.top + i * rowHeight;
    const w = Math.max(2, (row.value / max) * plotWidth);
    const seriesClass = row.series === 'insurance' ? 'series-2' : 'series-1';

    // Category name, in text ink rather than the series colour.
    svg.append(svgEl('text', {
      x: padding.left - 8, y: y + barThickness / 2 + 4,
      class: 'chart-label', 'text-anchor': 'end',
    }, row.label));

    const bar = svgEl('path', {
      d: barPath(padding.left, y, w, barThickness, 4, 'horizontal'),
      class: `chart-bar ${seriesClass}`,
      tabindex: '0',
      role: 'graphics-symbol',
      'aria-label': `${row.label}: ${yen(row.value)}`,
    });

    const describe = () => {
      const pct = row.share !== undefined ? ` · ${(row.share * 100).toFixed(1)}% of total` : '';
      tooltip.show(
        `<strong>${row.label}</strong><br>${yen(row.value)}${pct}`
        + (row.ja ? `<br><span class="tip-ja">${row.ja}</span>` : ''),
        padding.left + w, y + barThickness,
      );
    };
    bar.addEventListener('pointerenter', describe);
    bar.addEventListener('focus', describe);
    bar.addEventListener('pointerleave', tooltip.hide);
    bar.addEventListener('blur', tooltip.hide);
    svg.append(bar);

    // Direct value label at the tip.
    svg.append(svgEl('text', {
      x: padding.left + w + 8, y: y + barThickness / 2 + 4,
      class: 'chart-value',
    }, yen(row.value)));
  });

  container.append(svg);

  const hasInsurance = rows.some((r) => r.series === 'insurance');
  const hasTax = rows.some((r) => r.series !== 'insurance');
  if (hasInsurance && hasTax) {
    container.append(h('div.chart-legend',
      legendKey('Tax', 'series-1'),
      legendKey('Social insurance', 'series-2')));
  }

  container.append(tableView(
    ['Item', 'Amount'],
    rows.map((r) => [r.ja ? `${r.label} (${r.ja})` : r.label, yen(r.value)]),
    tableLabel,
  ));

  return container;
}

/**
 * Paired monthly columns for revenue and expenses.
 * Twelve months of two series, with a 2px surface gap inside each pair.
 */
export function monthlyColumns(months, { title } = {}) {
  const hasData = months.some((m) => m.sales !== 0 || m.expenses !== 0);
  if (!hasData) return h('div.chart-empty', 'No transactions recorded for this year yet.');

  const padding = { top: 12, right: 6, bottom: 26, left: 40 };
  const width = 360;
  const plotHeight = 150;
  const totalHeight = plotHeight + padding.top + padding.bottom;
  const plotWidth = width - padding.left - padding.right;
  const slot = plotWidth / 12;
  const barW = Math.min(11, (slot - 6) / 2);
  const gap = 2; // the surface gap between the paired columns

  const max = niceMax(Math.max(...months.map((m) => Math.max(m.sales, m.expenses)), 1));

  const container = h('figure.chart', { role: 'group', 'aria-label': title || 'Monthly revenue and expenses' });
  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${totalHeight}`, class: 'chart-svg',
    preserveAspectRatio: 'xMinYMin meet', role: 'img',
    'aria-label': `${title || 'Monthly figures'}. `
      + months.filter((m) => m.sales || m.expenses)
        .map((m) => `Month ${m.month}: revenue ${yen(m.sales)}, expenses ${yen(m.expenses)}`).join('. '),
  });

  // Horizontal gridlines with clean ticks.
  for (const frac of [0, 0.5, 1]) {
    const y = padding.top + plotHeight * (1 - frac);
    svg.append(svgEl('line', {
      x1: padding.left, y1: y, x2: width - padding.right, y2: y,
      class: frac === 0 ? 'chart-baseline' : 'chart-gridline',
    }));
    svg.append(svgEl('text', {
      x: padding.left - 6, y: y + 4, class: 'chart-tick', 'text-anchor': 'end',
    }, compact(max * frac)));
  }

  const tooltip = attachTooltip(container);

  months.forEach((m, i) => {
    const centre = padding.left + slot * i + slot / 2;
    const pairs = [
      { value: m.sales, cls: 'series-1', label: 'Revenue' },
      { value: m.expenses, cls: 'series-2', label: 'Expenses' },
    ];
    pairs.forEach((p, j) => {
      if (p.value <= 0) return;
      const barHeight = Math.max(2, (p.value / max) * plotHeight);
      const x = centre - barW - gap / 2 + j * (barW + gap);
      const y = padding.top + plotHeight - barHeight;
      const bar = svgEl('path', {
        d: barPath(x, y, barW, barHeight, 4, 'vertical'),
        class: `chart-bar ${p.cls}`, tabindex: '0', role: 'graphics-symbol',
        'aria-label': `Month ${m.month} ${p.label}: ${yen(p.value)}`,
      });
      const describe = () => tooltip.show(
        `<strong>${m.label}</strong><br>Revenue ${yen(m.sales)}<br>Expenses ${yen(m.expenses)}`
        + `<br>Net ${yen(m.net)}`,
        centre, y,
      );
      bar.addEventListener('pointerenter', describe);
      bar.addEventListener('focus', describe);
      bar.addEventListener('pointerleave', tooltip.hide);
      bar.addEventListener('blur', tooltip.hide);
      svg.append(bar);
    });

    // Label every third month, so the axis never crowds on a phone.
    if (i % 3 === 0) {
      svg.append(svgEl('text', {
        x: centre, y: totalHeight - 8, class: 'chart-tick', 'text-anchor': 'middle',
      }, m.month));
    }
  });

  container.append(svg);
  container.append(h('div.chart-legend',
    legendKey('Revenue', 'series-1'),
    legendKey('Expenses', 'series-2')));
  container.append(tableView(
    ['Month', 'Revenue', 'Expenses', 'Net'],
    months.filter((m) => m.sales || m.expenses)
      .map((m) => [m.label, yen(m.sales), yen(m.expenses), yen(m.net)]),
  ));
  return container;
}

function legendKey(label, seriesClass) {
  return h('span.legend-item',
    h(`span.legend-swatch.${seriesClass}`),
    h('span.legend-label', label));
}

/**
 * Progress toward a threshold — the consumption tax line, a deduction ceiling.
 * A meter rather than a chart: one value against one limit.
 */
export function meter({ label, value, limit, unit = 'yen', warnAt = 0.8, note }) {
  const ratio = limit > 0 ? value / limit : 0;
  const pct = Math.min(100, ratio * 100);
  const state = ratio >= 1 ? 'critical' : ratio >= warnAt ? 'warning' : 'good';

  return h('div.meter',
    h('div.meter-head',
      h('span.meter-label', label),
      h('span.meter-value',
        unit === 'yen' ? yen(value) : `${value}`,
        h('span.meter-limit', ` / ${unit === 'yen' ? yen(limit) : limit}`))),
    h('div.meter-track', {
      role: 'progressbar',
      'aria-valuenow': Math.round(value),
      'aria-valuemin': '0',
      'aria-valuemax': Math.round(limit),
      'aria-label': label,
    }, h(`div.meter-fill.is-${state}`, { style: { width: `${pct}%` } })),
    note ? h('p.meter-note', note) : null);
}

/**
 * A stat tile. The right form when there is one number and no shape to it —
 * an effective rate, a monthly set-aside.
 */
export function statTile({ label, value, sub, tone = 'neutral', ja }) {
  return h(`div.stat.tone-${tone}`,
    h('span.stat-label', label, ja ? h('span.stat-ja', ja) : null),
    h('span.stat-value', value),
    sub ? h('span.stat-sub', sub) : null);
}

/**
 * Collapsed table of the same figures, so nothing is locked behind colour or
 * hover. Present on every chart.
 */
function tableView(headers, rows, label = 'Show figures') {
  if (rows.length === 0) return null;
  return h('details.chart-table',
    h('summary', label),
    h('table',
      h('thead', h('tr', ...headers.map((hd) => h('th', hd)))),
      h('tbody', ...rows.map((r) => h('tr', ...r.map((c, i) => h(i === 0 ? 'th' : 'td', c)))))));
}

/** Simple sparkline for a run of values, used in list rows. */
export function sparkline(values, { width = 72, height = 20 } = {}) {
  if (!values.length) return h('span');
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`);
  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`, class: 'sparkline', 'aria-hidden': 'true',
  }, svgEl('polyline', { points: points.join(' '), class: 'sparkline-path' }));
  return svg;
}
