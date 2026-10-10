// Хранилище на телефоне: IndexedDB, одна таблица «ключ → значение».
// Всё личное (ответы, практики, дневник, цепочки, таблица навыков, отметки)
// лежит только здесь и никуда не отправляется.
window.DB = (() => {
  const NAME = "dbt-training", VERSION = 1, STORE = "kv";
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("IndexedDB недоступна"));
      let req;
      try { req = indexedDB.open(NAME, VERSION); } catch (e) { return reject(e); }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => {
        const db = req.result;
        // Другая вкладка обновила схему: закрываемся, чтобы не блокировать её
        db.onversionchange = () => { db.close(); dbp = null; };
        resolve(db);
      };
      req.onerror = () => reject(req.error || new Error("Не удалось открыть хранилище"));
      req.onblocked = () => reject(new Error("Хранилище занято другой вкладкой"));
    });
    dbp.catch(() => { dbp = null; });
    return dbp;
  }

  function tx(mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      let t;
      try { t = db.transaction(STORE, mode); } catch (e) { dbp = null; return reject(e); }
      const store = t.objectStore(STORE);
      let result;
      fn(store, r => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error || new Error("Ошибка записи"));
      t.onabort = () => reject(t.error || new Error("Запись прервана"));
    }));
  }

  return {
    open,
    // Все записи разом: { ключ: значение }
    getAll() {
      return tx("readonly", (s, done) => {
        const out = {};
        const req = s.openCursor();
        req.onsuccess = () => {
          const c = req.result;
          if (c) { out[c.key] = c.value; c.continue(); } else done(out);
        };
      });
    },
    set(key, value) {
      return tx("readwrite", s => { s.put(value, key); });
    },
    // Просим браузер не стирать данные сам (iOS/Android могут чистить «лишнее»)
    async persist() {
      try {
        if (!navigator.storage || !navigator.storage.persist) return false;
        if (await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
      } catch (e) { return false; }
    },
  };
})();
