// Reusable "Benchmark it" panel. A library page supplies a config; the panel builds
// its own controls, runs the WASM benchmark module in a Web Worker (downloaded only
// on first use), and renders a comparison table, bars, and a scaling chart.
import { WasmWorker } from './wasm-client.js';
import { summarize, compare } from './bench-stats.js';

const N = 'number';
const SIGS = {
  bench_run: [N, [N, N, N, N, N, N]],
  bench_sample: [N, [N, N]],
  bench_checksum: [N, [N]],
  bench_consistent: [N, []],
  bench_resolution_ns: [N, []],
};
const SVG_NS = 'http://www.w3.org/2000/svg';

const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v);
  }
  e.append(...kids);
  return e;
};
const svg = (tag, attrs = {}, text) => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text != null) e.textContent = text;
  return e;
};
const fmtNs = (v) => (v < 10 ? v.toFixed(2) : v.toFixed(1));
const fmtCount = (n) => n.toLocaleString('en-US');
const short = (n) => (n >= 1000 ? `${n / 1000}k` : String(n));

function field(label, control) {
  return el('label', { text: label }, control);
}
function select(options, selected) {
  const s = el('select');
  for (const [value, text] of options) {
    const o = el('option', { value: String(value), text });
    if (value === selected) o.selected = true;
    s.append(o);
  }
  return s;
}

function lineChart(points, nameA, nameB) {
  const W = 560, H = 270, m = { l: 54, r: 16, t: 14, b: 66 };
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img',
    'aria-label': `Nanoseconds per operation against cache capacity for ${nameA} and ${nameB}` });
  const xs = points.map((p) => Math.log10(p.x));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const yMax = Math.max(...points.flatMap((p) => [p.a, p.b])) * 1.1;
  const X = (v) => m.l + ((Math.log10(v) - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
  const Y = (v) => H - m.b - (v / yMax) * (H - m.t - m.b);

  for (let i = 0; i <= 4; i++) {
    const v = (yMax * i) / 4;
    chart.append(svg('line', { x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v), class: 'grid' }));
    chart.append(svg('text', { x: m.l - 6, y: Y(v) + 4, class: 'ct', 'text-anchor': 'end' }, v.toFixed(v < 10 ? 1 : 0)));
  }
  for (const p of points) {
    chart.append(svg('text', { x: X(p.x), y: H - m.b + 16, class: 'ct', 'text-anchor': 'middle' }, short(p.x)));
  }
  chart.append(svg('text', { x: (m.l + W - m.r) / 2, y: H - m.b + 34, class: 'ct', 'text-anchor': 'middle' }, 'cache capacity (log scale)'));
  chart.append(svg('text', { x: 12, y: (m.t + H - m.b) / 2, class: 'ct', 'text-anchor': 'middle',
    transform: `rotate(-90 12 ${(m.t + H - m.b) / 2})` }, 'ns per operation'));

  for (const [key, cls] of [['a', 'line-a'], ['b', 'line-b']]) {
    chart.append(svg('polyline', { points: points.map((p) => `${X(p.x)},${Y(p[key])}`).join(' '), class: `line ${cls}` }));
    for (const p of points) chart.append(svg('circle', { cx: X(p.x), cy: Y(p[key]), r: 3.5, class: `dot ${cls}` }));
  }
  const ly = H - 12;
  chart.append(svg('line', { x1: m.l, x2: m.l + 22, y1: ly - 4, y2: ly - 4, class: 'line line-a' }));
  chart.append(svg('text', { x: m.l + 28, y: ly, class: 'ct' }, nameA));
  chart.append(svg('line', { x1: m.l + 190, x2: m.l + 212, y1: ly - 4, y2: ly - 4, class: 'line line-b' }));
  chart.append(svg('text', { x: m.l + 218, y: ly, class: 'ct' }, nameB));
  return chart;
}

export function initBenchPanel(root, cfg) {
  const [nameA, nameB] = cfg.labels;
  let worker = null;
  let running = false;

  const workloadSel = select(cfg.workloads.map((w, i) => [i, w.label]), 0);
  const capSel = select(cfg.capacities.map((c) => [c, fmtCount(c)]), cfg.capacities[Math.min(1, cfg.capacities.length - 1)]);
  const opsSel = select([[0, 'Auto (recommended)'], ...cfg.opsChoices.map((c) => [c, fmtCount(c)])], 0);
  const precSel = select([[7, 'Quick (7 samples)'], [15, 'Standard (15 samples)'], [31, 'Thorough (31 samples)']], 15);
  const runBtn = el('button', { class: 'primary', text: 'Run benchmark' });
  const sweepBtn = el('button', { text: 'Scaling sweep' });
  const cancelBtn = el('button', { text: 'Cancel', hidden: '' });
  const desc = el('p', { class: 'note' });
  const status = el('p', { class: 'note', role: 'status' });
  const error = el('p', { class: 'error', role: 'alert' });
  const out = el('div', { 'aria-live': 'polite' });

  const showDesc = () => { desc.textContent = cfg.workloads[Number(workloadSel.value)].desc; };
  workloadSel.addEventListener('change', showDesc);
  showDesc();

  const env = el('details', { class: 'note' },
    el('summary', { text: 'How this is measured' }),
    el('p', { text: cfg.baselineNote }),
    el('p', { text: 'Both implementations get identical keys and the same operations, compiled with the same flags. Keys are scrambled so neither side benefits from consecutive integers. Setup is not timed. Rounds alternate order (A,B then B,A) and two warm-up rounds are discarded. Timings are WebAssembly in your browser, not native speed, and browser timers are deliberately coarse, so each sample runs long and the median is reported.' }),
    el('p', { text: `Your browser reports ${navigator.hardwareConcurrency || '?'} logical cores. ${navigator.userAgent}` }),
  );

  root.append(
    el('p', { class: 'note', text: `Compare ${nameA} with ${nameB} on your own machine.` }),
    el('div', { class: 'row' },
      field('Workload', workloadSel), field('Capacity', capSel),
      field('Operations per sample', opsSel), field('Precision', precSel)),
    desc,
    el('div', { class: 'row' }, runBtn, sweepBtn, cancelBtn),
    status, error, out, env,
  );

  function setUi(isRunning) {
    running = isRunning;
    for (const c of [runBtn, sweepBtn, workloadSel, capSel, opsSel, precSel]) c.disabled = isRunning;
    cancelBtn.hidden = !isRunning;
  }

  async function getWorker() {
    if (!worker) {
      status.textContent = 'Downloading the benchmark module…';
      worker = await WasmWorker.create({ moduleUrl: cfg.moduleUrl, sigs: SIGS });
    }
    return worker;
  }

  async function measure(workload, capacity, ops, samples) {
    const w = await getWorker();
    const n = await w.call('bench_run', workload, capacity, ops, samples, 100, 42);
    if (n < 0) throw new Error('The benchmark rejected these parameters.');
    const calls = [];
    for (const impl of [0, 1]) for (let i = 0; i < n; i++) calls.push(['bench_sample', [impl, i]]);
    calls.push(['bench_checksum', [0]], ['bench_checksum', [1]], ['bench_consistent', []], ['bench_resolution_ns', []]);
    const { results } = await w.batch(calls);
    const [c0, c1, consistent, resolutionNs] = results.slice(2 * n);
    return {
      a: summarize(results.slice(0, n)),
      b: summarize(results.slice(n, 2 * n)),
      same: consistent === 1 && c0 === c1,
      resolutionNs,
      samples: n,
    };
  }

  // Chooses how many operations each sample should run so that a sample lasts well
  // beyond the browser clock's resolution (at least 20 ms and 25 clock ticks).
  async function pickOps(workload, capacity) {
    const w = await getWorker();
    const resMs = (await w.call('bench_resolution_ns')) / 1e6;
    const targetMs = Math.max(20, resMs * 25);
    const maxOps = cfg.maxOps ?? 5_000_000;
    let ops = 100000;
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await measure(workload, capacity, ops, 3);
      const sampleMs = (Math.max(r.a.median, r.b.median) * ops) / 1e6;
      if (sampleMs >= targetMs || ops >= maxOps) break;
      const scale = sampleMs > 0 ? Math.min(targetMs / sampleMs, 16) : 16;
      ops = Math.min(maxOps, Math.ceil(ops * scale * 1.1));
    }
    return ops;
  }

  function renderSingle(r, ops, auto) {
    const cmp = compare(r.a, r.b, nameA, nameB);
    const slowest = Math.max(r.a.median, r.b.median);
    const table = el('table', { class: 'results' });
    table.append(el('thead', {}, el('tr', {},
      ...['Implementation', 'Median ns/op', 'Middle 50%', 'Million ops/s', ''].map((t) => el('th', { text: t })))));
    const body = el('tbody');
    for (const [name, s, cls] of [[nameA, r.a, 'bar-a'], [nameB, r.b, 'bar-b']]) {
      const fill = el('div', { class: `bar-fill ${cls}` });
      fill.style.width = `${(s.median / slowest) * 100}%`;
      body.append(el('tr', {},
        el('td', { text: name }),
        el('td', { text: fmtNs(s.median) }),
        el('td', { text: `${fmtNs(s.p25)} – ${fmtNs(s.p75)}` }),
        el('td', { text: (1000 / s.median).toFixed(1) }),
        el('td', {}, el('div', { class: 'bar-track' }, fill))));
    }
    table.append(body);

    const sampleMs = (Math.max(r.a.median, r.b.median) * ops) / 1e6;
    const resMs = r.resolutionNs / 1e6;
    const lines = [
      el('p', { class: 'verdict', text: cmp.text }),
      el('p', { class: r.same ? 'note ok' : 'error',
        text: r.same
          ? '✓ Both implementations returned identical results for the identical operation sequence.'
          : '⚠ The implementations returned different results, so this comparison is not trustworthy.' }),
      el('p', { class: 'note',
        text: `${fmtCount(ops)} operations per sample${auto ? ' (chosen automatically)' : ''}, about ${sampleMs.toFixed(1)} ms each; the browser clock steps in ${resMs.toFixed(resMs < 0.1 ? 3 : 2)} ms. ${r.samples} samples each.` }),
    ];
    if (resMs > 0 && sampleMs < resMs * 20) {
      lines.push(el('p', { class: 'error', text: 'Samples are short compared with the timer resolution. Choose more operations for a reliable result.' }));
    }
    out.replaceChildren(table, ...lines);
  }

  function renderSweep(rows) {
    const table = el('table', { class: 'results' });
    table.append(el('thead', {}, el('tr', {},
      ...['Capacity', `${nameA} ns/op`, `${nameB} ns/op`, 'Ratio'].map((t) => el('th', { text: t })))));
    const body = el('tbody');
    for (const p of rows) {
      body.append(el('tr', {},
        el('td', { text: fmtCount(p.x) }), el('td', { text: fmtNs(p.a) }), el('td', { text: fmtNs(p.b) }),
        el('td', { text: `${(p.b / p.a).toFixed(2)}×` })));
    }
    table.append(body);
    out.replaceChildren(lineChart(rows, nameA, nameB), table,
      el('p', { class: 'note', text: `Medians, with the operation count chosen automatically at each capacity. A ratio above 1 means ${nameA} is faster. Dips and bumps as capacity grows are mostly CPU cache effects.` }));
  }

  async function guarded(fn) {
    if (running) return;
    setUi(true);
    error.textContent = '';
    try {
      await fn();
    } catch (e) {
      if (e.message === 'cancelled') status.textContent = 'Cancelled.';
      else { status.textContent = ''; error.textContent = e.message; }
    } finally {
      setUi(false);
    }
  }

  runBtn.onclick = () => guarded(async () => {
    const [workload, capacity, chosenOps, samples] = [workloadSel, capSel, opsSel, precSel].map((s) => Number(s.value));
    const auto = chosenOps === 0;
    let ops = chosenOps;
    if (auto) {
      status.textContent = 'Calibrating how many operations each sample needs…';
      ops = await pickOps(workload, capacity);
    }
    status.textContent = 'Running… (the page stays responsive)';
    const r = await measure(workload, capacity, ops, samples);
    status.textContent = '';
    renderSingle(r, ops, auto);
  });

  sweepBtn.onclick = () => guarded(async () => {
    const workload = Number(workloadSel.value);
    const rows = [];
    for (const [i, capacity] of cfg.sweepCapacities.entries()) {
      status.textContent = `Scaling sweep: capacity ${fmtCount(capacity)} (${i + 1} of ${cfg.sweepCapacities.length})…`;
      const ops = await pickOps(workload, capacity);
      const r = await measure(workload, capacity, ops, 9);
      if (!r.same) throw new Error(`Results differed between implementations at capacity ${fmtCount(capacity)}.`);
      rows.push({ x: capacity, a: r.a.median, b: r.b.median });
    }
    status.textContent = '';
    renderSweep(rows);
  });

  cancelBtn.onclick = () => {
    if (worker) { worker.terminate(); worker = null; }
  };
}
