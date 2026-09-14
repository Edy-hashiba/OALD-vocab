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

syncBtn.addEventListener('click', () => runSync({ interactive: true }));

/* Try a quiet sync on open and when coming back online, so the phone usually
 * already has the latest list before it is touched. */
window.addEventListener('load', () => {
  idle();
  if (navigator.onLine && Sync.configured()) runSync({ interactive: false });
});
window.addEventListener('online', () => {
  if (Sync.configured()) runSync({ interactive: false });
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
