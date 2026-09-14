/*
 * Storage layer. Everything else talks to the vocabulary list through this,
 * so that Phase 2 can swap chrome.storage.local for a Google Drive backed
 * store without touching the UI.
 *
 * A word moves through three states:
 *   live      - being studied; appears in the list, review and quiz
 *   archived  - graduated by the learner; kept but never shown for study
 *   tombstone - deleted; only {id, deleted, deletedAt} remains
 *
 * Deletion leaves a tombstone rather than dropping the key, because a merge
 * that only ever adds records cannot express a deletion: without it, a word
 * deleted on the phone would come back from the copy still held on the PC.
 */
(function (global) {
  'use strict';

  const KEY = 'words';
  const SCHEMA = 2;

  // Leitner box intervals in days. Box 0 is "never reviewed".
  const INTERVALS = [0, 1, 3, 7, 14, 30, 90];

  const DAY = 864e5;
  const ATTENTION_DAYS = 60;   // "saved two months ago and still not graduated"
  const ARCHIVE_PURGE_DAYS = 90; // archived this long ago -> really deleted
  const TOMBSTONE_DAYS = 90;   // tombstone kept this long so sync can see it

  const now = () => new Date().toISOString();
  const ageDays = (iso) => (Date.now() - Date.parse(iso)) / DAY;

  const isTomb = (r) => !!(r && r.deleted);
  const isLive = (r) => !!r && !r.deleted && !r.archived;

  /* ---------- storage backend ----------
   * The same code runs in the extension and in the phone web app, so the place
   * the collection lives is chosen at load time. localStorage is deliberately
   * not an option: its ~5MB cap is right where a few hundred words land. */

  function chromeStore() {
    const a = chrome.storage.local;
    return {
      name: 'chrome.storage.local',
      async read() { return (await a.get(KEY))[KEY] || {}; },
      async write(map) { await a.set({ [KEY]: map }); }
    };
  }

  function idbStore() {
    const DB = 'oald-vocab';
    const TABLE = 'kv';
    let open;

    const conn = () => (open ??= new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(TABLE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));

    const tx = async (mode, run) => {
      const db = await conn();
      return new Promise((res, rej) => {
        const t = db.transaction(TABLE, mode);
        const req = run(t.objectStore(TABLE));
        t.oncomplete = () => res(req?.result);
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error);
      });
    };

    return {
      name: 'IndexedDB',
      async read() { return (await tx('readonly', (s) => s.get(KEY))) || {}; },
      async write(map) { await tx('readwrite', (s) => s.put(map, KEY)); }
    };
  }

  const store =
    typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local
      ? chromeStore()
      : idbStore();

  const readMap = () => store.read();
  const writeMap = (map) => store.write(map);

  function freshSrs() {
    return { box: 0, due: now(), correct: 0, wrong: 0 };
  }

  /* Housekeeping, run whenever the collection is read. Archived words age into
   * tombstones, and tombstones eventually disappear once every device has had
   * a chance to see them. */
  async function purge() {
    const map = await readMap();
    let changed = false;
    for (const [id, r] of Object.entries(map)) {
      if (isTomb(r)) {
        if (ageDays(r.deletedAt) > TOMBSTONE_DAYS) {
          delete map[id];
          changed = true;
        }
      } else if (r.archived && ageDays(r.archivedAt) > ARCHIVE_PURGE_DAYS) {
        map[id] = { id, deleted: true, deletedAt: now(), updatedAt: now() };
        changed = true;
      }
    }
    if (changed) await writeMap(map);
    return map;
  }

  async function getAll({ include = 'live' } = {}) {
    const map = await purge();
    const keep =
      include === 'archived' ? (r) => r && r.archived && !r.deleted
      : include === 'all' ? (r) => r && !r.deleted
      : isLive;
    return Object.values(map).filter(keep).sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
  }

  async function get(id) {
    const r = (await readMap())[id];
    return isTomb(r) ? null : r || null;
  }

  async function has(id) {
    return !!(await get(id));
  }

  const senseKey = (s) => s.key || s.def;

  /* Saving keeps the learner's own note and review history, and refreshes the
   * dictionary content. Re-saving a word that was archived or deleted revives
   * it: going back to look it up again means it is wanted after all.
   *
   * `keys` limits which senses are stored. A word like "run" has 39 senses but
   * only one was looked up, so saving all of them would bury the wanted
   * meaning and bloat every review card. Omit `keys` to save the whole entry.
   * Senses already held are kept and refreshed, never dropped, so visiting the
   * page again to save a second meaning adds to the record. */
  async function save(word, keys = null) {
    const map = await readMap();
    const prev = map[word.id];
    const revive = !prev || isTomb(prev);

    const wanted = keys ? new Set(keys) : null;
    const kept = new Map();
    /* Records written before senses carried an OALD id are keyed by their
     * definition text. Indexing both ways stops a re-save from storing the
     * same meaning twice, once under each kind of key. */
    const byDef = new Map();
    if (!revive) {
      for (const s of prev.senses || []) {
        kept.set(senseKey(s), s);
        byDef.set(s.def, senseKey(s));
      }
    }
    for (const s of word.senses || []) {
      const k = senseKey(s);
      const existing = kept.has(k) ? k : byDef.get(s.def);
      if (wanted && !wanted.has(k) && existing === undefined) continue;
      if (existing !== undefined && existing !== k) kept.delete(existing);
      kept.set(k, s);
    }
    /* Keep the dictionary's own ordering rather than the click order. */
    const order = (word.senses || []).map(senseKey);
    const senses = [...kept.values()].sort(
      (a, b) => order.indexOf(senseKey(a)) - order.indexOf(senseKey(b))
    );

    map[word.id] = {
      schema: SCHEMA,
      ...word,
      senses,
      note: revive ? '' : prev.note || '',
      savedAt: revive ? now() : prev.savedAt,
      updatedAt: now(),
      srs: revive ? freshSrs() : prev.srs || freshSrs(),
      archived: false,
      archivedAt: null,
      deleted: false
    };
    await writeMap(map);
    return map[word.id];
  }

  /* Dropping a meaning that turned out not to be the one wanted. The last
   * sense cannot be removed - a word with no meaning is just clutter, so the
   * caller should delete the whole record instead. */
  async function removeSense(id, key) {
    const w = await get(id);
    if (!w || (w.senses || []).length <= 1) return null;
    return update(id, { senses: w.senses.filter((s) => senseKey(s) !== key) });
  }

  async function update(id, patch) {
    const map = await readMap();
    if (!map[id] || isTomb(map[id])) return null;
    map[id] = { ...map[id], ...patch, updatedAt: now() };
    await writeMap(map);
    return map[id];
  }

  /* Graduation: the learner says they know it. Kept, but out of the way. */
  async function archive(id) {
    return update(id, { archived: true, archivedAt: now() });
  }

  async function unarchive(id) {
    return update(id, { archived: false, archivedAt: null });
  }

  async function remove(id) {
    const map = await readMap();
    if (!map[id]) return;
    map[id] = { id, deleted: true, deletedAt: now(), updatedAt: now() };
    await writeMap(map);
  }

  async function grade(id, correct) {
    const w = await get(id);
    if (!w) return null;
    const srs = w.srs || freshSrs();
    const box = correct ? Math.min(srs.box + 1, INTERVALS.length - 1) : 0;
    return update(id, {
      srs: {
        box,
        due: new Date(Date.now() + INTERVALS[box] * DAY).toISOString(),
        correct: srs.correct + (correct ? 1 : 0),
        wrong: srs.wrong + (correct ? 0 : 1),
        streak: correct ? (srs.streak || 0) + 1 : 0,
        lastReviewedAt: now()
      }
    });
  }

  async function due() {
    const t = Date.now();
    return (await getAll()).filter((w) => !w.srs || Date.parse(w.srs.due) <= t);
  }

  /* Saved two months ago and never graduated. These are not deleted - they are
   * the words most worth another look, so the review screen surfaces them. */
  async function needsAttention() {
    return (await getAll())
      .filter((w) => ageDays(w.savedAt) >= ATTENTION_DAYS)
      .sort((a, b) => (b.srs?.wrong || 0) - (a.srs?.wrong || 0));
  }

  async function stats() {
    const map = await purge();
    const all = Object.values(map);
    return {
      live: all.filter(isLive).length,
      archived: all.filter((r) => r.archived && !r.deleted).length,
      attention: (await needsAttention()).length,
      due: (await due()).length
    };
  }

  async function exportJSON() {
    const map = await purge();
    return JSON.stringify(
      { schema: SCHEMA, exportedAt: now(), words: Object.values(map) },
      null,
      2
    );
  }

  /* Merge keeps whichever copy was updated most recently, so importing an old
   * backup can never silently undo newer edits - and a tombstone wins the same
   * way, which is what makes deletions propagate instead of being resurrected. */
  async function importJSON(text, { merge = true } = {}) {
    const parsed = JSON.parse(text);
    const incoming = Array.isArray(parsed) ? parsed : parsed.words;
    if (!Array.isArray(incoming)) throw new Error('Unrecognised file format');

    const map = merge ? await readMap() : {};
    let added = 0;
    let updated = 0;
    let removed = 0;
    for (const w of incoming) {
      if (!w || !w.id) continue;
      const prev = map[w.id];
      if (!prev) {
        map[w.id] = w;
        if (!isTomb(w)) added++;
      } else if ((w.updatedAt || '') > (prev.updatedAt || '')) {
        map[w.id] = w;
        if (isTomb(w) && !isTomb(prev)) removed++;
        else updated++;
      }
    }
    await writeMap(map);
    return { added, updated, removed, total: Object.values(map).filter(isLive).length };
  }

  global.VocabDB = {
    KEY, INTERVALS, ATTENTION_DAYS, ARCHIVE_PURGE_DAYS,
    backend: store.name,
    getAll, get, has, save, update, remove, removeSense, senseKey,
    archive, unarchive, grade, due, needsAttention, stats,
    exportJSON, importJSON
  };
})(typeof window !== 'undefined' ? window : self);
