import { LIBRARIES } from './libraries.js';

const grid = document.getElementById('libs');
for (const lib of LIBRARIES) {
  const live = lib.status === 'live';
  const el = document.createElement(live ? 'a' : 'div');
  el.className = 'lib' + (live ? '' : ' soon');
  if (live) el.href = `./${lib.slug}/`;

  const h = document.createElement('h3');
  const name = document.createElement('span');
  name.textContent = lib.name;
  const badge = document.createElement('span');
  badge.className = 'badge' + (live ? ' live' : '');
  badge.textContent = live ? 'live' : 'soon';
  h.append(name, badge);

  const p = document.createElement('p');
  p.textContent = lib.blurb;
  el.append(h, p);
  grid.append(el);
}
