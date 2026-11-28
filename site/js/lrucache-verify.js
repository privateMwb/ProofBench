import { initVerifyPanel } from './verify-panel.js';
import { CLAIMS, VERIFY_SIGS } from './lrucache-claims.js';

initVerifyPanel(document.getElementById('verify-root'), {
  moduleUrl: new URL('../wasm/lrucache_verify.js', import.meta.url),
  sigs: VERIFY_SIGS,
  claims: CLAIMS,
});
