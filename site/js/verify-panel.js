// Reusable "Verify it" panel: one card per README claim, each with a Verify button.
// The claim definitions (cfg.claims) supply the quote, the method, and a run(worker)
// function that returns { status, headline, tables, notes }.
import { WasmWorker } from './wasm-client.js';
import { el } from './dom.js';

export const STATUS = {
  idle: ['Not run', 'st-idle'],
  running: ['Running…', 'st-run'],
  pass: ['✓ Verified', 'st-pass'],
  partial: ['◐ Holds only in some cases', 'st-partial'],
  fail: ['✗ Not verified', 'st-fail'],
  error: ['! Could not run', 'st-error'],
};

function renderTable(t) {
  const table = el('table', { class: 'results' });
  if (t.caption) table.append(el('caption', { text: t.caption }));
  table.append(el('thead', {}, el('tr', {}, ...t.columns.map((c) => el('th', { scope: 'col', text: c })))));
  table.append(el('tbody', {}, ...t.rows.map((r) => el('tr', {}, ...r.map((c, i) => el(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row', text: c } : { text: c }))))));
  return el('div', { class: 'table-scroll' }, table);
}

export function initVerifyPanel(root, cfg) {
  let worker = null;
  let busy = false;
  const cards = [];
  const summary = el('p', { class: 'note', role: 'status' });
  const allBtn = el('button', { class: 'primary', text: 'Verify all claims' });

  root.append(
    el('p', { class: 'note', text: 'Each claim below is quoted from the README. Pressing Verify runs a real measurement or experiment in your browser and reports what it found, including failures.' }),
    el('div', { class: 'row' }, allBtn),
    summary,
  );

  const results = new Map();
  function updateSummary() {
    const done = [...results.values()];
    if (done.length === 0) { summary.textContent = ''; return; }
    const n = (s) => done.filter((r) => r.status === s).length;
    const parts = [`${n('pass')} of ${cfg.claims.length} claims verified`];
    if (n('partial')) parts.push(`${n('partial')} ${n('partial') === 1 ? 'holds' : 'hold'} only in some cases`);
    if (n('fail')) parts.push(`${n('fail')} not verified`);
    if (n('error')) parts.push(`${n('error')} could not run`);
    summary.textContent = parts.join(', ') + '.';
  }

  for (const claim of cfg.claims) {
    const badge = el('span', { class: 'status st-idle', text: STATUS.idle[0] });
    const btn = el('button', { text: 'Verify' });
    const out = el('div', { 'aria-live': 'polite' });
    const card = el('article', { class: 'claim' },
      el('blockquote', { text: `“${claim.quote}”` }),
      el('div', { class: 'claim-head' }, el('h3', { text: claim.title }), badge),
      el('details', { class: 'note' }, el('summary', { text: 'How this is checked' }), el('p', { text: claim.how })),
      el('div', { class: 'row' }, btn),
      out);
    root.append(card);

    const setStatus = (s) => { badge.textContent = STATUS[s][0]; badge.className = `status ${STATUS[s][1]}`; };

    const run = async () => {
      setStatus('running');
      out.replaceChildren();
      let r;
      try {
        if (!worker) worker = await WasmWorker.create({ moduleUrl: cfg.moduleUrl, sigs: cfg.sigs });
        r = await claim.run(worker);
      } catch (e) {
        r = { status: 'error', headline: `Could not run: ${e.message}`, tables: [], notes: [] };
      }
      results.set(claim.id, r);
      setStatus(r.status);
      out.replaceChildren(
        el('p', { class: 'verdict', text: r.headline }),
        ...r.tables.map(renderTable),
        ...r.notes.map((n) => el('p', { class: 'note', text: n })));
      updateSummary();
    };
    cards.push({ btn, run });
  }

  const setBusy = (b) => { busy = b; allBtn.disabled = b; for (const c of cards) c.btn.disabled = b; };
  const guarded = async (fn) => { if (busy) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };
  cards.forEach((c) => { c.btn.onclick = () => guarded(c.run); });
  allBtn.onclick = () => guarded(async () => { for (const c of cards) await c.run(); });
}
