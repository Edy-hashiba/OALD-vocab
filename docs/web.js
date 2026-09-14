/* Web-app-only glue: the sync button, its status line, and the service worker.
   review.js drives everything else and is shared with the extension. */
'use strict';

const syncBtn = document.getElementById('sync');
const statusEl = document.getElementById('sync-status');

function say(text, kind) {
  statusEl.hidden = !text;
  statusEl.textContent = text || '';
  statusEl.className = 'sync-status' + (kind ? ' is-' + kind : '');
}

const ago = (iso) => {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min} 分前`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} 時間前` : `${Math.round(h / 24)} 日前`;
};

function idle() {
  if (!Sync.configured()) {
    say('config.js の CLIENT_ID が未設定のため同期できません。書き出し／読み込みは使えます。', 'warn');
    syncBtn.disabled = true;
    return;
  }
  const at = Sync.lastSyncAt();
  say(at ? `最終同期: ${ago(at)}` : '', at ? null : undefined);
}

async function runSync({ interactive }) {
  if (!Sync.configured() || syncBtn.disabled) return;
  syncBtn.disabled = true;
  say('同期中…');
  try {
    const r = await Sync.sync({ interactive });
    await load();
    show(currentView());
    await pushToBridge();
    const parts = [];
    if (r.added) parts.push(`新規 ${r.added}`);
    if (r.updated) parts.push(`更新 ${r.updated}`);
    if (r.removed) parts.push(`削除 ${r.removed}`);
    say(`同期しました${parts.length ? '（' + parts.join(' / ') + '）' : '（変更なし）'}`, 'ok');
    setTimeout(idle, 4000);
  } catch (e) {
    /* A silent attempt that needs a real sign-in is not an error worth
     * shouting about - it just means the button has to be pressed. */
    if (!interactive) idle();
    else say('同期できませんでした: ' + e.message, 'bad');
  } finally {
    syncBtn.disabled = false;
  }
}

const currentView = () =>
  document.querySelector('.tab.is-active')?.dataset.view || 'list';

/* ---------- bridge to the Chrome extension ----------
 * The extension saves into its own storage and never talks to Drive, so on a
 * PC its words only get anywhere by passing through this page. Its content
 * script announces itself and offers what it holds; we merge that in, and hand
 * the merged collection back so its save bar stays accurate. */

let bridgeSeen = false;

window.addEventListener('message', async (e) => {
  if (e.source !== window || e.origin !== location.origin) return;
  const msg = e.data;
  if (!msg || msg.from !== 'oald-extension') return;

  if (msg.type === 'OALD_BRIDGE_READY') {
    bridgeSeen = true;
    return;
  }

  if (msg.type === 'OALD_BRIDGE_WORDS') {
    bridgeSeen = true;
    const r = await VocabDB.importJSON(JSON.stringify(msg.payload));
    if (r.added || r.updated) {
      await load();
      show(currentView());
      say(`拡張機能から ${r.added + r.updated} 語を取り込みました`, 'ok');
      setTimeout(idle, 4000);
    }
    /* Give the extension the merged picture back, including anything that
     * arrived from Drive or another device. */
    window.postMessage({ type: 'OALD_BRIDGE_PUSH', json: await VocabDB.exportJSON() }, location.origin);
  }
});

/* After a sync, let the extension see what came down from Drive. */
async function pushToBridge() {
  if (!bridgeSeen) return;
  window.postMessage({ type: 'OALD_BRIDGE_PUSH', json: await VocabDB.exportJSON() }, location.origin);
}

syncBtn.addEventListener('click', () => runSync({ interactive: true }));

/* Try a quiet sync on open and when coming back online, so the phone usually
 * already has the latest list before it is touched.
 *
 * Only once this device has synced before, though: a silent token request on a
 * device that has never signed in still opens a popup, which the browser blocks
 * and logs as an error. Signing in the first time is the button's job. */
const canSyncQuietly = () => Sync.configured() && !!Sync.lastSyncAt();

window.addEventListener('load', () => {
  idle();
  if (navigator.onLine && canSyncQuietly()) runSync({ interactive: false });
});
window.addEventListener('online', () => {
  if (canSyncQuietly()) runSync({ interactive: false });
});

if ('serviceWorker' in navigator) {
  /* Assets are served from the cache first, so the load right after a deploy
   * runs the previous build while the new one is still being fetched. Reload
   * once when the new worker takes over, so an update reaches the device on
   * the first visit rather than the second.
   *
   * Guarded on there having been a controller already: on the very first
   * registration the worker also takes over, and reloading then would be a
   * pointless extra load - and, if it ever recurred, a loop. */
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
