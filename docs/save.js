/*
 * Landing page for the bookmarklet: takes the word out of the URL fragment,
 * stores it, and pushes it to Drive if sync is set up.
 *
 * The word arrives in the fragment rather than the query string, so it is
 * never sent to GitHub Pages - the server only ever sees a request for
 * save.html itself.
 */
'use strict';

const out = document.getElementById('result');

const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k);
  return n;
};

const link = (href, text, cls) =>
  el('a', { href, className: 'act ' + (cls || ''), textContent: text });

function show(...nodes) {
  out.textContent = '';
  out.append(...nodes);
}

function fail(msg, detail) {
  show(
    el('div', { className: 'card' },
      el('div', { className: 'card-head' }, el('span', { className: 'hw', textContent: '保存できませんでした' })),
      el('p', { className: 'def', textContent: msg }),
      detail ? el('p', { className: 'q-sub', textContent: detail }) : null,
      el('div', { className: 'actions' }, link('index.html', '単語帳を開く'))));
}

(async () => {
  const raw = location.hash.slice(1);
  if (!raw) {
    fail('単語のデータがありません。',
      'OALD の意味ページでブックマークレットを実行してください。');
    return;
  }

  let word;
  try {
    word = JSON.parse(decodeURIComponent(raw));
  } catch {
    fail('データを読み取れませんでした。', 'もう一度ブックマークレットを実行してください。');
    return;
  }
  if (!word?.id || !Array.isArray(word.senses) || !word.senses.length) {
    fail('データの形式が正しくありません。');
    return;
  }

  show(el('p', { className: 'empty', textContent: '保存しています…' }));

  let saved;
  try {
    /* Passing the chosen keys keeps any senses already stored on this device
     * instead of replacing them with just this visit's selection. */
    saved = await VocabDB.save(word, word.senses.map((s) => s.key || s.def));
  } catch (e) {
    fail('端末への保存に失敗しました。', e.message);
    return;
  }

  /* Clear the fragment so a refresh does not re-run the save, and so the word
   * is not left sitting in the address bar. */
  history.replaceState(null, '', location.pathname);

  const note = el('textarea', { className: 'note', rows: 2, placeholder: 'メモ（任意）' });
  note.addEventListener('change', () => VocabDB.update(saved.id, { note: note.value.trim() }));

  const syncLine = el('p', { className: 'q-sub' });

  show(
    el('div', { className: 'card' },
      el('div', { className: 'card-head' },
        el('span', { className: 'hw', textContent: saved.word }),
        saved.pos ? el('span', { className: 'pos', textContent: saved.pos }) : null,
        saved.cefr ? el('span', { className: 'cefr', textContent: saved.cefr }) : null,
        el('span', { className: 'spacer' }),
        el('span', { className: 'box', textContent: '保存しました' })),
      el('div', { className: 'body' }, saved.senses.map((s) =>
        el('div', { className: 'sense' },
          s.shcut ? el('div', { className: 'shcut', textContent: s.shcut }) : null,
          el('p', { className: 'def', textContent: s.def })))),
      note,
      syncLine,
      el('div', { className: 'actions' },
        link('index.html', '単語帳を開く'),
        link(saved.url, 'OALD に戻る'))));

  if (!Sync.configured()) {
    syncLine.textContent = 'この端末に保存しました（Drive 同期は未設定）。';
    return;
  }
  if (!navigator.onLine) {
    syncLine.textContent = 'この端末に保存しました。オンラインになったら同期されます。';
    return;
  }

  /* Offer the sign-in right here rather than sending the learner off to the
   * app. A phone can easily open this page in a different storage context from
   * the installed app - Safari and a Home Screen web app do not share a
   * database - so a word that stops at "saved on this device" is effectively
   * lost. Reaching Drive is what actually makes it saved. */
  function offerSync(message) {
    syncLine.textContent = message;
    const btn = el('button', { className: 'reveal', type: 'button',
      textContent: 'Google にサインインして同期' });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      syncLine.textContent = 'Drive と同期しています…';
      try {
        await Sync.sync({ interactive: true });
        syncLine.textContent = 'Drive と同期しました。';
        btn.remove();
      } catch (e) {
        syncLine.textContent = '同期できませんでした: ' + e.message;
        btn.disabled = false;
      }
    });
    syncLine.after(el('div', { className: 'grade' }, btn));
  }

  /* A silent token request on a device that has never signed in opens a popup,
   * which the browser blocks - so ask for the sign-in explicitly instead. */
  if (!Sync.lastSyncAt()) {
    offerSync('この端末に保存しました。Drive に送るにはサインインが必要です。');
    return;
  }

  syncLine.textContent = 'Drive と同期しています…';
  try {
    await Sync.sync({ interactive: false });
    syncLine.textContent = 'Drive と同期しました。';
  } catch {
    offerSync('この端末に保存しました。承認の期限が切れています。');
  }
})();
