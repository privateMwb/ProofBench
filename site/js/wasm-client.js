// Promise-based client for wasm-worker.js.
//   const w = await WasmWorker.create({ moduleUrl, sigs });
//   const { results, ms } = await w.batch([['fn', [arg1, arg2]], ...]);
export class WasmWorker {
  #worker;
  #pending = new Map();
  #nextId = 1;

  constructor() {
    this.#worker = new Worker(new URL('./wasm-worker.js', import.meta.url), { type: 'module' });
    this.#worker.onmessage = ({ data }) => {
      const p = this.#pending.get(data.id);
      if (!p) return;
      this.#pending.delete(data.id);
      if (data.ok) p.resolve(data);
      else p.reject(new Error(data.error));
    };
    this.#worker.onerror = (e) => {
      for (const p of this.#pending.values()) p.reject(new Error(e.message || 'worker error'));
      this.#pending.clear();
    };
  }

  #send(msg) {
    return new Promise((resolve, reject) => {
      const id = this.#nextId++;
      this.#pending.set(id, { resolve, reject });
      this.#worker.postMessage({ ...msg, id });
    });
  }

  // sigs: { fnName: [returnType, [argTypes...]] } using Emscripten cwrap types.
  static async create({ moduleUrl, sigs }) {
    const w = new WasmWorker();
    await w.#send({ type: 'init', moduleUrl: new URL(moduleUrl, location.href).href, sigs });
    return w;
  }

  async batch(calls) {
    const { results, ms } = await this.#send({ type: 'batch', calls });
    return { results, ms };
  }

  async call(name, ...args) {
    const { results } = await this.batch([[name, args]]);
    return results[0];
  }

  terminate() {
    for (const p of this.#pending.values()) p.reject(new Error('cancelled'));
    this.#pending.clear();
    this.#worker.terminate();
  }
}
