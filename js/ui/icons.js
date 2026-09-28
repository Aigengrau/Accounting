/** Inline SVG icons. Stroke-based, currentColor, 24px grid. */

const SVG_NS = 'http://www.w3.org/2000/svg';

const PATHS = {
  home: 'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  calculator: 'M5 3h14v18H5zM8 7h8M8 11h2M12 11h2M16 11h2M8 15h2M12 15h2M16 15h2M8 19h6',
  lightbulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'
    + 'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 11 4a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 20 11a2 2 0 1 1 0 4z',
  calendar: 'M4 6h16v15H4zM4 10h16M9 3v4M15 3v4',
  book: 'M4 4h7v17H4zM13 4h7v17h-7M11 4v17',
  inbox: 'M3 13h5l1 3h6l1-3h5M3 13l3-8h12l3 8v7H3z',
  cloud: 'M17.5 18a3.5 3.5 0 0 0 0-7 5.5 5.5 0 0 0-10.7-1.2A4 4 0 0 0 7 18z',
  cpu: 'M6 6h12v12H6zM9.5 9.5h5v5h-5M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3',
  wifi: 'M2.5 9a15 15 0 0 1 19 0M5.5 12.5a10 10 0 0 1 13 0M8.5 16a5.5 5.5 0 0 1 7 0M12 19.5h.01',
  zap: 'M13 2 4 14h6l-1 8 9-12h-6z',
  train: 'M6 3h12v12H6zM6 15l-2 5M18 15l2 5M9 8h6M9.5 18h5',
  coffee: 'M4 8h13v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM17 9h2a2.5 2.5 0 0 1 0 5h-2M3 21h16',
  gift: 'M4 11h16v10H4zM3 7h18v4H3zM12 7v14M12 7S10.5 3 8 3a2 2 0 0 0 0 4M12 7s1.5-4 4-4a2 2 0 0 1 0 4',
  percent: 'M19 5 5 19M7.5 9.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM16.5 19.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  users: 'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-2a4 4 0 0 0-3-3.9M16 2.1a4 4 0 0 1 0 7.8',
  file: 'M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6',
  package: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  out: 'M15 4h4v16h-4M11 8l-4 4 4 4M7 12h9',
  in: 'M9 4H5v16h4M13 8l4 4-4 4M17 12H8',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  check: 'M4 12.5 9 18 20 6',
  alert: 'M12 3 1.5 21h21zM12 9v5M12 17.5h.01',
  download: 'M12 3v12M7 11l5 5 5-5M4 21h16',
  upload: 'M12 16V4M7 8l5-5 5 5M4 21h16',
  chart: 'M4 20V9M10 20V4M16 20v-7M22 20H2',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3.5 9h17M3.5 15h17M12 3c-2.5 2.5-2.5 15 0 18M12 3c2.5 2.5 2.5 15 0 18',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4M12 15v2',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
  edit: 'M4 20h4L20 8l-4-4L4 16zM14.5 5.5 18.5 9.5',
  scale: 'M12 3v18M7 21h10M4 8h16M4 8l-2.5 6h5zM20 8l-2.5 6h5z',
};

export function icon(name, { size = 24, className = '' } = {}) {
  const d = PATHS[name] || PATHS.more;
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
  if (className) svg.setAttribute('class', className);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

export const ICON_NAMES = Object.keys(PATHS);
