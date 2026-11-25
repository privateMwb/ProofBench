// Generic WASM worker: loads one Emscripten module and runs batches of calls on it,
// keeping the page responsive. Reused by every library page.
let fns = null;

self.onmessage = async ({ data: msg }) => {
  try {
    if (msg.type === 'init') {
      const { default: factory } = await import(msg.moduleUrl);
      const mod = await factory();
      fns = {};
      for (const [name, [ret, args]] of Object.entries(msg.sigs)) {
        fns[name] = mod.cwrap(name, ret, args);
      }
      self.postMessage({ id: msg.id, ok: true });
    } else if (msg.type === 'batch') {
      if (!fns) throw new Error('module not initialised');
      const t0 = performance.now();
      const results = msg.calls.map(([name, args]) => {
        const fn = fns[name];
        if (!fn) throw new Error(`unknown function ${name}`);
        return fn(...args);
      });
      self.postMessage({ id: msg.id, ok: true, results, ms: performance.now() - t0 });
    } else {
      throw new Error(`unknown message type ${msg.type}`);
    }
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: String((err && err.message) || err) });
  }
};
