const { parentPort, workerData } = require('node:worker_threads');
const { config } = require('../../server/config');
const { Store } = require('../../server/store');
const store = new Store(config({
  AUTH_MODE: 'dev', FAKE_MODEL: '1', CAP_DAILY_USD: '200', DB_PATH: workerData.dbPath,
}), () => Date.parse('2026-10-16T22:00:00Z'));
const barrier = new Int32Array(workerData.barrier);
parentPort.postMessage({ ready: true });
Atomics.wait(barrier, 0, 0);
try {
  store.reserve(workerData.session, workerData.session, 0.06, true);
  parentPort.postMessage({ reserved: true });
} catch (error) { parentPort.postMessage({ error: error.code || error.message }); }
finally { store.close(); }
