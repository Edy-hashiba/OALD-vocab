/*
 * Google Drive sync.
 *
 * The collection lives in one JSON file in the user's own Drive. Syncing is
 * pull-merge-push: the remote copy is merged into the local one with
 * VocabDB.importJSON (newest updatedAt per record wins, and tombstones win the
 * same way so deletions propagate), then the merged result is written back.
 *
 * Only a Client ID is used. There is no client secret and no server: the token
 * is obtained in the browser with Google Identity Services and lives in memory
 * for about an hour.
 */
(function (global) {
  'use strict';

  const CFG = global.OALD_CONFIG || {};
  const LAST_SYNC_KEY = 'lastSyncAt';
  const DRIVE = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

  let token = null;
  let tokenExpiry = 0;
  let tokenClient = null;
  let fileId = null;

  const configured = () => !!CFG.CLIENT_ID;

  const lastSyncAt = () => localStorage.getItem(LAST_SYNC_KEY) || null;

  /* ---------- auth ---------- */

  function initClient() {
    if (tokenClient) return tokenClient;
    if (!global.google?.accounts?.oauth2) {
      throw new Error('Google のライブラリが読み込めていません（オフラインの可能性があります）');
    }
    tokenClient = global.google.accounts.oauth2.initTokenClient({
      client_id: CFG.CLIENT_ID,
      scope: CFG.SCOPE,
      callback: () => {} // replaced per request below
    });
    return tokenClient;
  }

  /* `interactive: false` reuses an existing grant without showing a popup, so
   * routine syncs are silent after the first sign-in. */
  function getToken({ interactive = true } = {}) {
    if (token && Date.now() < tokenExpiry - 60_000) return Promise.resolve(token);
    if (!configured()) return Promise.reject(new Error('CLIENT_ID が設定されていません'));

    return new Promise((resolve, reject) => {
      const client = initClient();
      client.callback = (res) => {
        if (res.error) return reject(new Error(res.error_description || res.error));
        token = res.access_token;
        tokenExpiry = Date.now() + (Number(res.expires_in) || 3600) * 1000;
        resolve(token);
      };
      client.error_callback = (err) => reject(new Error(err?.type || 'サインインに失敗しました'));
      try {
        client.requestAccessToken({ prompt: interactive ? '' : 'none' });
      } catch (e) {
        reject(e);
      }
    });
  }

  function signOut() {
    if (token && global.google?.accounts?.oauth2) {
      global.google.accounts.oauth2.revoke(token, () => {});
    }
    token = null;
    tokenExpiry = 0;
    fileId = null;
  }

  const signedIn = () => !!token && Date.now() < tokenExpiry;

  /* ---------- drive ---------- */

  async function api(url, opts = {}) {
    const t = await getToken({ interactive: false }).catch(() => getToken());
    const res = await fetch(url, {
      ...opts,
      headers: { Authorization: 'Bearer ' + t, ...(opts.headers || {}) }
    });
    if (res.status === 401) {
      /* The grant was revoked or the token died early - ask once more. */
      token = null;
      const t2 = await getToken();
      return fetch(url, {
        ...opts,
        headers: { Authorization: 'Bearer ' + t2, ...(opts.headers || {}) }
      });
    }
    return res;
  }

  async function findFile() {
    if (fileId) return fileId;
    const q = encodeURIComponent(`name='${CFG.FILE_NAME}' and trashed=false`);
    const res = await api(`${DRIVE}/files?q=${q}&spaces=drive&fields=files(id,modifiedTime)`);
    if (!res.ok) throw new Error('Drive の検索に失敗しました (' + res.status + ')');
    const data = await res.json();
    fileId = data.files?.[0]?.id || null;
    return fileId;
  }

  async function readRemote() {
    const id = await findFile();
    if (!id) return null;
    const res = await api(`${DRIVE}/files/${id}?alt=media`);
    if (!res.ok) throw new Error('Drive の読み込みに失敗しました (' + res.status + ')');
    return res.text();
  }

  async function writeRemote(text) {
    const id = await findFile();
    const body = new Blob([text], { type: 'application/json' });

    if (id) {
      const res = await api(`${UPLOAD}/files/${id}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body
      });
      if (!res.ok) throw new Error('Drive への保存に失敗しました (' + res.status + ')');
      return id;
    }

    /* First run: create the file. multipart carries metadata and content. */
    const boundary = 'oald' + Math.random().toString(36).slice(2);
    const meta = { name: CFG.FILE_NAME, mimeType: 'application/json' };
    const payload =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n` +
      `--${boundary}--`;

    const res = await api(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: payload
    });
    if (!res.ok) throw new Error('Drive でのファイル作成に失敗しました (' + res.status + ')');
    fileId = (await res.json()).id;
    return fileId;
  }

  /* ---------- sync ---------- */

  async function sync({ interactive = true } = {}) {
    if (!configured()) throw new Error('CLIENT_ID が設定されていません');
    if (!navigator.onLine) throw new Error('オフラインです');

    await getToken({ interactive });

    let pulled = { added: 0, updated: 0, removed: 0 };
    const remote = await readRemote();
    if (remote) {
      /* Same merge rule as importing a backup file, so a word deleted on one
       * device does not come back from the other. */
      pulled = await VocabDB.importJSON(remote);
    }

    const merged = await VocabDB.exportJSON();
    await writeRemote(merged);

    const at = new Date().toISOString();
    localStorage.setItem(LAST_SYNC_KEY, at);
    return { ...pulled, at, bytes: merged.length };
  }

  /* Where a sync problem actually is, reported from the device that has it.
   * Phones have no console to look at, and every sync failure so far has come
   * down to one of these four things: the wrong account, two files with the
   * same name, an empty remote, or a local copy that never received anything. */
  async function diagnose() {
    const out = {
      configured: configured(),
      online: navigator.onLine,
      lastSync: lastSyncAt(),
      local: (await VocabDB.getAll({ include: 'all' })).length
    };
    if (!out.configured || !out.online) return out;

    await getToken({ interactive: true });

    try {
      const res = await api(`${DRIVE}/about?fields=user`);
      out.account = res.ok ? (await res.json()).user?.emailAddress || '(不明)' : '(取得できません)';
    } catch {
      out.account = '(取得できません)';
    }

    const q = encodeURIComponent(`name='${CFG.FILE_NAME}' and trashed=false`);
    const res = await api(`${DRIVE}/files?q=${q}&spaces=drive&fields=files(id,modifiedTime,size)`);
    if (!res.ok) throw new Error('Drive の検索に失敗しました (' + res.status + ')');
    const files = (await res.json()).files || [];
    out.fileCount = files.length;
    out.files = files.map((f) => ({ id: f.id, modified: f.modifiedTime, size: Number(f.size) || 0 }));

    if (files.length) {
      const body = await api(`${DRIVE}/files/${files[0].id}?alt=media`).then((r) => r.text());
      try {
        const parsed = JSON.parse(body);
        const list = Array.isArray(parsed) ? parsed : parsed.words || [];
        out.remote = list.length;
        out.remoteLive = list.filter((w) => w && !w.deleted && !w.archived).length;
      } catch {
        out.remote = '(読めません)';
      }
    }
    return out;
  }

  global.Sync = {
    configured, signedIn, signOut, sync, lastSyncAt, diagnose,
    FILE_NAME: CFG.FILE_NAME
  };
})(window);
