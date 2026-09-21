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
    /* Collect anything saved in the extension since this page loaded, so it
     * travels up with this sync rather than waiting for a reload. */
    await pullFromBridge();
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
let awaitingPull = null;

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
    awaitingPull?.(r);
  }
});

/* Ask the extension for what it holds right now.
 *
 * The extension offers its words once, when this page loads. Words saved after
 * that - the normal case, since the dictionary is where saving happens - would
 * otherwise sit in the extension while sync pushed this page's stale copy to
 * Drive, and nothing would ever reach the phone. So every sync starts by asking
 * again. */
function pullFromBridge(timeoutMs = 2000) {
  if (!bridgeSeen) return Promise.resolve(null);
  return new Promise((resolve) => {
    const finish = (r) => {
      if (awaitingPull !== finish) return;
      awaitingPull = null;
      resolve(r);
    };
    awaitingPull = finish;
    window.postMessage({ type: 'OALD_BRIDGE_PULL' }, location.origin);
    /* The extension may have been disabled since it announced itself. */
    setTimeout(() => finish(null), timeoutMs);
  });
}

/* After a sync, let the extension see what came down from Drive. */
async function pushToBridge() {
  if (!bridgeSeen) return;
  window.postMessage({ type: 'OALD_BRIDGE_PUSH', json: await VocabDB.exportJSON() }, location.origin);
}

syncBtn.addEventListener('click', () => runSync({ interactive: true }));

/* ---------- diagnostics ---------- */

const diagBtn = document.getElementById('diag');

function verdictFor(d, fromExtension) {
  if (!d.configured) return ['bad', 'CLIENT_ID が設定されていません。'];
  if (!d.online) return ['bad', 'オフラインです。'];
  if (d.fileCount === 0) return ['bad', 'Drive にファイルがありません。一度「同期」を押してください。'];
  if (d.fileCount > 1) {
    return ['bad', `同じ名前のファイルが ${d.fileCount} 個あります。端末ごとに別のファイルを`
      + '読み書きしている可能性が高いので、Drive で古いほうを削除してください。'];
  }
  if (d.remote === 0 && d.local > 0) {
    return ['bad', 'この端末には単語があるのに Drive は空です。「同期」を押すと送られます。'];
  }
  if (d.local === 0 && d.remote > 0) {
    return ['bad', 'Drive には単語があるのにこの端末は空です。「同期」を押すと取り込まれます。'];
  }
  if (d.remote !== d.local) {
    return ['', `Drive と この端末で語数が違います（${d.remote} / ${d.local}）。`
      + '「同期」を押すと揃います。'];
  }
  return ['ok', '一致しています。'
    + (fromExtension ? '' : ' ※拡張機能はこの端末では検出されていません。')];
}

diagBtn.addEventListener('click', async () => {
  document.getElementById('diag-box')?.remove();
  const box = document.createElement('div');
  box.id = 'diag-box';
  box.className = 'diag';
  box.textContent = '調べています…';
  statusEl.after(box);

  let d;
  try {
    /* Count the extension's words too, so "PC に入れたのに" can be answered. */
    await pullFromBridge();
    d = await Sync.diagnose();
  } catch (e) {
    box.textContent = '診断できませんでした: ' + e.message;
    return;
  }

  const rows = [
    ['同期先アカウント', d.account || '(未サインイン)'],
    ['この端末の単語', String(d.local)],
    ['Drive の単語', d.remote === undefined ? '(ファイルなし)' : String(d.remote)],
    ['Drive のファイル数', String(d.fileCount ?? 0)],
    ['最終同期', d.lastSync ? new Date(d.lastSync).toLocaleString('ja-JP') : '(なし)'],
    ['拡張機能', bridgeSeen ? '検出' : '未検出'],
    ['保存先', VocabDB.backend]
  ];
  if (d.files?.length) {
    rows.push(['ファイル ID', d.files.map((f) => f.id).join(' / ')]);
    rows.push(['ファイル更新', new Date(d.files[0].modified).toLocaleString('ja-JP')]);
  }

  const [kind, text] = verdictFor(d, bridgeSeen);
  box.textContent = '';
  const h = document.createElement('h3');
  h.textContent = '同期の診断';
  const table = document.createElement('table');
  for (const [k, v] of rows) {
    const tr = document.createElement('tr');
    const td1 = document.createElement('td');
    td1.textContent = k;
    const td2 = document.createElement('td');
    const code = document.createElement('code');
    code.textContent = v;
    td2.append(code);
    tr.append(td1, td2);
    table.append(tr);
  }
  const verdict = document.createElement('div');
  verdict.className = 'verdict ' + kind;
  verdict.textContent = text;
  box.append(h, table, verdict);
});

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
