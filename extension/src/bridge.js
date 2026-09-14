/*
 * Runs as a content script inside the web app, and is the only path by which
 * words captured by the extension reach Google Drive.
 *
 * The extension itself deliberately does no OAuth - that would mean pinning the
 * extension's ID - so the web app syncs on its behalf. Being a content script
 * rather than an externally_connectable endpoint means the page never needs to
 * know the extension's ID, which for an unpacked extension depends on where the
 * folder happens to sit.
 *
 * The exchange is symmetric: the extension offers what it holds, the page
 * merges it with everything else (and with Drive), and hands the merged result
 * back so the save bar on dictionary pages stays accurate.
 */
(function () {
  'use strict';

  const KEY = 'words';
  const post = (msg) => window.postMessage({ ...msg, from: 'oald-extension' }, location.origin);

  async function readAll() {
    const got = await chrome.storage.local.get(KEY);
    return got[KEY] || {};
  }

  async function offer() {
    const map = await readAll();
    post({
      type: 'OALD_BRIDGE_WORDS',
      /* Shaped like an export file so the page can reuse its merge logic. */
      payload: { schema: 2, exportedAt: new Date().toISOString(), words: Object.values(map) }
    });
  }

  async function accept(json) {
    const incoming = JSON.parse(json);
    const list = Array.isArray(incoming) ? incoming : incoming.words;
    if (!Array.isArray(list)) return;

    const map = await readAll();
    let changed = 0;
    for (const w of list) {
      if (!w || !w.id) continue;
      const prev = map[w.id];
      /* Same rule the app uses: the most recently updated copy wins, and a
       * tombstone wins the same way so deletions propagate back here too. */
      if (!prev || (w.updatedAt || '') > (prev.updatedAt || '')) {
        map[w.id] = w;
        changed++;
      }
    }
    if (changed) await chrome.storage.local.set({ [KEY]: map });
    post({ type: 'OALD_BRIDGE_ACCEPTED', changed });
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const msg = e.data;
    if (!msg || msg.from === 'oald-extension') return;
    if (msg.type === 'OALD_BRIDGE_PULL') offer();
    else if (msg.type === 'OALD_BRIDGE_PUSH') accept(msg.json);
  });

  /* Announce the extension so the page can show that the bridge is available
   * without having to poll for it. */
  post({ type: 'OALD_BRIDGE_READY' });
  offer();
})();
