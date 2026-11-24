/* Kwebbel – lokale opslag (IndexedDB). Alles blijft op dit apparaat. */
(function (G) {
  'use strict';
  const NAME = 'kwebbel', VER = 1;
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(NAME, VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('kv');
        d.createObjectStore('contacts', { keyPath: 'id' });
        const m = d.createObjectStore('msgs', { keyPath: 'id' }); m.createIndex('conv', 'conv');
        d.createObjectStore('files');
        const q = d.createObjectStore('copyq', { keyPath: 'id' }); q.createIndex('parent', 'parent');
        const mi = d.createObjectStore('mirror', { keyPath: 'id' }); mi.createIndex('child', 'child');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function tx(store, mode, fn) {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode); let out;
      let inner; try { inner = Promise.resolve(fn(t.objectStore(store))); } catch (e) { rej(e); return; }
      inner.then((v) => { out = v; }, (e) => { try { t.abort(); } catch (x) {} rej(e); });
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  }
  const DB = {
    get: (s, k) => tx(s, 'readonly', (o) => req(o.get(k))),
    put: (s, v, k) => tx(s, 'readwrite', (o) => req(k === undefined ? o.put(v) : o.put(v, k))),
    del: (s, k) => tx(s, 'readwrite', (o) => req(o.delete(k))),
    all: (s) => tx(s, 'readonly', (o) => req(o.getAll())),
    byIndex: (s, idx, v) => tx(s, 'readonly', (o) => req(o.index(idx).getAll(v))),
    clear: (s) => tx(s, 'readwrite', (o) => req(o.clear())),
    async delWhere(s, idx, v) { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(s, 'readwrite'); const r = t.objectStore(s).index(idx).openCursor(IDBKeyRange.only(v)); r.onsuccess = () => { const c = r.result; if (c) { c.delete(); c.continue(); } }; t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); },
    /* Bestanden: als Blob bewaren; lukt dat niet (sommige Safari-situaties), dan als ArrayBuffer */
    async putFile(fid, blob) {
      try { await DB.put('files', blob, fid); }
      catch (e) { await DB.put('files', { buf: await blob.arrayBuffer(), type: blob.type || '', name: blob.name || '' }, fid); }
    },
    async getFile(fid) {
      const r = await DB.get('files', fid);
      if (r && !(r instanceof Blob) && r.buf) return new Blob([r.buf], { type: r.type });
      return r;
    },
    async wipe() { const d = await open(); d.close(); dbp = null; await new Promise((res) => { const r = indexedDB.deleteDatabase(NAME); r.onsuccess = r.onerror = r.onblocked = () => res(); }); },
  };
  G.KDB = DB;
})(window);
