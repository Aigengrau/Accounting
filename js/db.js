/**
 * IndexedDB persistence.
 *
 * Everything lives on the device. There is no server, no account, and no network
 * call that carries your financial data anywhere — which is the only responsible
 * arrangement for a tax app served off a public GitHub Pages URL.
 *
 * The trade-off is real and worth stating plainly: clearing your browser data
 * deletes your books. The app nags about exporting for exactly that reason, and
 * `exportAll` produces a single JSON file that restores everything.
 */

const DB_NAME = 'aoiro';
const DB_VERSION = 1;

export const STORES = {
  TRANSACTIONS: 'transactions',
  JOURNAL: 'journal',
  ASSETS: 'assets',        // 固定資産台帳
  CLIENTS: 'clients',
  SETTINGS: 'settings',
  FX_RATES: 'fxRates',     // cached reference rates
  DOCUMENTS: 'documents',  // receipt images and invoice PDFs
  YEARS: 'years',          // per-year opening balances and filing state
};

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('This browser has no IndexedDB, so the app cannot store your data.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      const tx = event.target.transaction;

      if (!db.objectStoreNames.contains(STORES.TRANSACTIONS)) {
        const s = db.createObjectStore(STORES.TRANSACTIONS, { keyPath: 'id' });
        s.createIndex('date', 'date');
        s.createIndex('year', 'year');
        s.createIndex('kind', 'kind');
        s.createIndex('account', 'account');
        s.createIndex('clientId', 'clientId');
      }
      if (!db.objectStoreNames.contains(STORES.JOURNAL)) {
        const s = db.createObjectStore(STORES.JOURNAL, { keyPath: 'id' });
        s.createIndex('date', 'date');
        s.createIndex('transactionId', 'transactionId');
      }
      if (!db.objectStoreNames.contains(STORES.ASSETS)) {
        const s = db.createObjectStore(STORES.ASSETS, { keyPath: 'id' });
        s.createIndex('acquiredDate', 'acquiredDate');
      }
      if (!db.objectStoreNames.contains(STORES.CLIENTS)) {
        db.createObjectStore(STORES.CLIENTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
        db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORES.FX_RATES)) {
        db.createObjectStore(STORES.FX_RATES, { keyPath: 'key' }); // `${currency}:${date}`
      }
      if (!db.objectStoreNames.contains(STORES.DOCUMENTS)) {
        const s = db.createObjectStore(STORES.DOCUMENTS, { keyPath: 'id' });
        s.createIndex('transactionId', 'transactionId');
      }
      if (!db.objectStoreNames.contains(STORES.YEARS)) {
        db.createObjectStore(STORES.YEARS, { keyPath: 'year' });
      }
      if (tx) tx.oncomplete = () => {};
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open the database.'));
    req.onblocked = () => reject(new Error('The database is blocked by another open tab. Close other tabs and reload.'));
  });
  return dbPromise;
}

function run(storeName, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try {
      result = fn(store);
    } catch (err) {
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(result?.__req ? result.__req.result : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted.'));
  }));
}

const wrap = (req) => ({ __req: req });

export const db = {
  async put(storeName, value) {
    await run(storeName, 'readwrite', (s) => wrap(s.put(value)));
    return value;
  },

  async putMany(storeName, values) {
    await run(storeName, 'readwrite', (s) => {
      for (const v of values) s.put(v);
      return values.length;
    });
    return values.length;
  },

  get(storeName, key) {
    return run(storeName, 'readonly', (s) => wrap(s.get(key)));
  },

  getAll(storeName) {
    return run(storeName, 'readonly', (s) => wrap(s.getAll())).then((r) => r || []);
  },

  getByIndex(storeName, indexName, value) {
    return run(storeName, 'readonly', (s) => wrap(s.index(indexName).getAll(value))).then((r) => r || []);
  },

  delete(storeName, key) {
    return run(storeName, 'readwrite', (s) => wrap(s.delete(key)));
  },

  clear(storeName) {
    return run(storeName, 'readwrite', (s) => wrap(s.clear()));
  },

  async setting(key, value) {
    if (value === undefined) {
      const row = await db.get(STORES.SETTINGS, key);
      return row?.value;
    }
    await db.put(STORES.SETTINGS, { key, value });
    return value;
  },

  /**
   * Full backup. The only way data leaves the device, and only when you press it.
   */
  async exportAll() {
    const [transactions, journal, assets, clients, settings, years, documents] = await Promise.all([
      db.getAll(STORES.TRANSACTIONS),
      db.getAll(STORES.JOURNAL),
      db.getAll(STORES.ASSETS),
      db.getAll(STORES.CLIENTS),
      db.getAll(STORES.SETTINGS),
      db.getAll(STORES.YEARS),
      db.getAll(STORES.DOCUMENTS),
    ]);
    return {
      format: 'aoiro-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      counts: {
        transactions: transactions.length, journal: journal.length,
        assets: assets.length, clients: clients.length, documents: documents.length,
      },
      data: { transactions, journal, assets, clients, settings, years, documents },
    };
  },

  /**
   * Restores a backup.
   * @param {object} backup parsed JSON from exportAll
   * @param {'replace'|'merge'} mode replace wipes first; merge keeps existing ids
   */
  async importAll(backup, mode = 'replace') {
    if (backup?.format !== 'aoiro-backup') {
      throw new Error('That file is not an Aoiro backup.');
    }
    const map = {
      transactions: STORES.TRANSACTIONS, journal: STORES.JOURNAL, assets: STORES.ASSETS,
      clients: STORES.CLIENTS, settings: STORES.SETTINGS, years: STORES.YEARS,
      documents: STORES.DOCUMENTS,
    };
    if (mode === 'replace') {
      for (const store of Object.values(map)) await db.clear(store);
    }
    let restored = 0;
    for (const [key, store] of Object.entries(map)) {
      const rows = backup.data?.[key];
      if (Array.isArray(rows) && rows.length) {
        await db.putMany(store, rows);
        restored += rows.length;
      }
    }
    return restored;
  },

  /** Wipes everything. Used only behind an explicit confirmation. */
  async wipe() {
    for (const store of Object.values(STORES)) await db.clear(store);
  },

  /** Storage headroom, so the app can warn before writes start failing. */
  async usage() {
    if (!navigator.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    return { usage, quota, percent: quota ? (usage / quota) * 100 : 0 };
  },

  /**
   * Asks the browser to treat this data as persistent, which makes it far less
   * likely to be evicted when the device runs low on space.
   */
  async requestPersistence() {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return navigator.storage.persist();
  },
};
