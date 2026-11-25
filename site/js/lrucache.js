import { WasmWorker } from './wasm-client.js';

const N = 'number';
const SIGS = {
  lru_create: [N, [N]], lru_clear: [null, []], lru_resize: [N, [N]],
  lru_put: [N, [N, N]], lru_evicted_key: [N, []],
  lru_get: [N, [N]], lru_peek: [N, [N]], lru_last_value: [N, []], lru_erase: [N, [N]],
  lru_snapshot: [N, []], lru_key_at: [N, [N]], lru_value_at: [N, [N]],
  lru_size: [N, []], lru_capacity: [N, []], lru_hits: [N, []], lru_misses: [N, []],
  lru_hit_rate: [N, []], lru_reset_stats: [null, []],
  lru_run_workload: [N, [N, N, N, N, N]],
};

const INT_MIN = -2147483648;
const INT_MAX = 2147483647;
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CONTROLS = ['create', 'put', 'get', 'peek', 'erase', 'clear', 'demo-basic', 'demo-evict', 'w-run'];

let w = null;
let busy = false;
let touched = null;
let evicted = null;

function setBusy(b) {
  busy = b;
  for (const id of CONTROLS) $(id).disabled = b || !w;
}

function showError(msg) { $('error').textContent = msg || ''; }

function readInt(id, label, min = INT_MIN, max = INT_MAX) {
  const raw = $(id).value.trim();
  const n = Number(raw);
  if (raw === '' || !Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${label} must be a whole number between ${min} and ${max}.`);
  }
  return n;
}

function log(text, kind = '') {
  const li = document.createElement('li');
  li.textContent = text;
  if (kind) li.className = kind;
  const list = $('log');
  list.prepend(li);
  while (list.children.length > 40) list.lastChild.remove();
}

function card(cls, key, value, tag) {
  const el = document.createElement('div');
  el.className = `card ${cls}`;
  const t = document.createElement('span'); t.className = 'tag'; t.textContent = tag;
  const k = document.createElement('span'); k.className = 'k'; k.textContent = key;
  const v = document.createElement('span'); v.className = 'v'; v.textContent = value;
  el.append(t, k, v);
  return el;
}

async function refresh() {
  const { results: [count, size, cap, hits, misses, rate] } = await w.batch([
    ['lru_snapshot', []], ['lru_size', []], ['lru_capacity', []],
    ['lru_hits', []], ['lru_misses', []], ['lru_hit_rate', []],
  ]);
  const calls = [];
  for (let i = 0; i < count; i++) calls.push(['lru_key_at', [i]], ['lru_value_at', [i]]);
  const { results } = calls.length ? await w.batch(calls) : { results: [] };

  const nodes = [];
  for (let i = 0; i < count; i++) {
    const key = results[2 * i];
    const value = results[2 * i + 1];
    let tag = '';
    let cls = '';
    if (i === 0) tag = 'newest';
    if (i === count - 1) {
      tag = count === 1 ? 'newest' : 'next out';
      cls = size === cap ? 'lru full' : 'lru';
    }
    if (key === touched) cls += ' touched';
    nodes.push(card(cls, key, value, tag));
  }
  for (let i = count; i < cap; i++) nodes.push(card('empty', '·', '·', ''));
  $('cache').replaceChildren(...nodes);

  $('s-size').textContent = size;
  $('s-cap').textContent = cap;
  $('s-hits').textContent = hits;
  $('s-miss').textContent = misses;
  $('s-rate').textContent = rate.toFixed(1);

  const chip = $('evicted');
  chip.hidden = evicted === null;
  if (evicted !== null) chip.textContent = `Evicted key ${evicted}`;
}

const ops = {
  async put(k, v) {
    const { results: [ev, ek] } = await w.batch([['lru_put', [k, v]], ['lru_evicted_key', []]]);
    touched = k;
    evicted = ev ? ek : null;
    log(`put(${k}, ${v})` + (ev ? `  → evicted key ${ek}` : ''), ev ? 'evict' : '');
  },
  async get(k) {
    const { results: [hit, val] } = await w.batch([['lru_get', [k]], ['lru_last_value', []]]);
    touched = hit ? k : null;
    evicted = null;
    log(hit ? `get(${k}) → ${val}  (hit)` : `get(${k}) → not found  (miss)`, hit ? '' : 'miss');
  },
  async peek(k) {
    const { results: [hit, val] } = await w.batch([['lru_peek', [k]], ['lru_last_value', []]]);
    touched = null;
    evicted = null;
    log(hit ? `peek(${k}) → ${val}  (recency unchanged)` : `peek(${k}) → not found`, hit ? '' : 'miss');
  },
  async erase(k) {
    const removed = await w.call('lru_erase', k);
    touched = null;
    evicted = null;
    log(removed ? `erase(${k}) → removed` : `erase(${k}) → not present`, removed ? '' : 'miss');
  },
};

async function createCache(cap) {
  const ok = await w.call('lru_create', cap);
  if (!ok) throw new Error('Capacity must be between 1 and 16.');
  touched = null;
  evicted = null;
  $('log').replaceChildren();
}

async function guarded(fn) {
  if (busy || !w) return;
  setBusy(true);
  showError('');
  try { await fn(); await refresh(); }
  catch (e) { showError(e.message); }
  finally { setBusy(false); }
}

const SCRIPTS = {
  basic: {
    capacity: 4,
    note: 'Inserts, a read, an update, a delete and a miss. Every get and put moves that key to the front.',
    steps: [['put', 1, 10], ['put', 2, 20], ['put', 3, 30], ['get', 2], ['put', 2, 25], ['erase', 1], ['get', 9]],
  },
  evict: {
    capacity: 3,
    note: 'Key 2 is evicted before key 1 even though 1 was inserted first, because get(1) refreshed it. peek leaves the order alone.',
    steps: [['put', 1, 10], ['put', 2, 20], ['put', 3, 30], ['get', 1], ['put', 4, 40], ['put', 5, 50], ['peek', 1]],
  },
};

async function playScript(name) {
  const s = SCRIPTS[name];
  $('cap').value = s.capacity;
  $('demo-note').textContent = s.note;
  await createCache(s.capacity);
  await refresh();
  for (const [op, ...args] of s.steps) {
    await sleep(700);
    await ops[op](...args);
    await refresh();
  }
}

async function runSweep() {
  const universe = readInt('w-uni', 'Distinct keys', 100, 100000);
  const requests = readInt('w-ops', 'Requests', 1000, 1000000);
  const skew100 = Math.round(Number($('w-skew').value) * 100);
  const fractions = [0.01, 0.02, 0.05, 0.1, 0.2, 0.4];
  const caps = fractions.map((f) => Math.max(1, Math.round(universe * f)));

  $('w-note').textContent = 'Running…';
  const { results, ms } = await w.batch(caps.map((c) => ['lru_run_workload', [c, universe, requests, skew100, 42]]));
  if (results.some((r) => r < 0)) throw new Error('Workload parameters were rejected.');

  const rows = results.map((rate, i) => {
    const row = document.createElement('div'); row.className = 'bar-row';
    const label = document.createElement('span');
    label.textContent = `cap ${caps[i]} (${Math.round(fractions[i] * 100)}%)`;
    const track = document.createElement('div'); track.className = 'bar-track';
    const fill = document.createElement('div'); fill.className = 'bar-fill'; fill.style.width = `${rate}%`;
    track.append(fill);
    const val = document.createElement('span'); val.textContent = `${rate.toFixed(1)}%`;
    row.append(label, track, val);
    return row;
  });
  $('w-bars').replaceChildren(...rows);
  $('w-note').textContent =
    `${(caps.length * requests).toLocaleString()} simulated requests in ${ms.toFixed(0)} ms (WebAssembly, your browser). Fixed seed, so reruns match.`;
}

function wire() {
  $('create').onclick = () => guarded(async () => createCache(readInt('cap', 'Capacity', 1, 16)));
  $('put').onclick = () => guarded(() => ops.put(readInt('key', 'Key'), readInt('val', 'Value')));
  $('get').onclick = () => guarded(() => ops.get(readInt('key', 'Key')));
  $('peek').onclick = () => guarded(() => ops.peek(readInt('key', 'Key')));
  $('erase').onclick = () => guarded(() => ops.erase(readInt('key', 'Key')));
  $('clear').onclick = () => guarded(async () => { await w.call('lru_clear'); touched = null; evicted = null; log('clear()'); });
  $('demo-basic').onclick = () => guarded(() => playScript('basic'));
  $('demo-evict').onclick = () => guarded(() => playScript('evict'));
  $('w-run').onclick = () => guarded(runSweep);
  $('w-skew').oninput = () => { $('w-skew-out').textContent = Number($('w-skew').value).toFixed(1); };
}

(async () => {
  wire();
  try {
    w = await WasmWorker.create({ moduleUrl: new URL('../wasm/lrucache.js', import.meta.url), sigs: SIGS });
    await createCache(4);
    await refresh();
    $('status').textContent = 'WebAssembly loaded.';
    setBusy(false);
  } catch (e) {
    $('status').textContent = '';
    showError(`Failed to load WebAssembly: ${e.message}. Did you run the build and commit site/wasm/?`);
  }
})();
