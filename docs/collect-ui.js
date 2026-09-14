/*
 * The half of the bookmarklet that runs on the OALD page.
 *
 * build-pwa.ps1 prepends extension/src/parser.js to this file to produce
 * docs/collect.js, so the phone and the extension read the dictionary with
 * exactly the same code.
 *
 * Senses are picked here rather than after the jump, because only the chosen
 * ones travel in the URL - "run" has 39 senses and all of them would make an
 * awkwardly long address.
 */
(function () {
  'use strict';

  const PANEL = 'oald-collect-panel';
  const SAVE_URL = new URL('save.html', document.currentScript?.src
    || 'https://edy-hashiba.github.io/OALD-vocab/collect.js').href;

  document.getElementById(PANEL)?.remove();

  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k);
    return n;
  };

  const panel = el('div', { id: PANEL });
  const shut = () => panel.remove();

  const parsed = window.OALDParser?.parse();

  if (!parsed) {
    panel.append(
      el('div', { className: 'oc-head' }, el('b', { textContent: 'OALD 単語帳' })),
      el('p', { className: 'oc-msg',
        textContent: '単語の意味ページで実行してください（検索結果ページでは使えません）。' }),
      el('div', { className: 'oc-foot' },
        Object.assign(el('button', { textContent: '閉じる', type: 'button' }),
          { onclick: shut })));
    document.body.append(panel);
    return;
  }

  const boxes = new Map();
  const only = parsed.senses.length === 1;

  const senseRows = parsed.senses.map((s, i) => {
    const cb = el('input', { type: 'checkbox', checked: only });
    boxes.set(s.key || s.def, { cb, sense: s });
    return el('label', { className: 'oc-sense' },
      cb,
      el('span', {},
        s.shcut ? el('em', { textContent: s.shcut }) : null,
        el('span', { className: 'oc-def',
          textContent: `${i + 1}. ${s.def}` }),
        s.cefr ? el('b', { className: 'oc-cefr', textContent: s.cefr }) : null));
  });

  const status = el('p', { className: 'oc-msg' });
  const saveBtn = el('button', { className: 'oc-primary', textContent: '保存', type: 'button' });

  const selected = () => [...boxes.values()].filter((b) => b.cb.checked).map((b) => b.sense);

  function refresh() {
    const n = selected().length;
    saveBtn.disabled = n === 0;
    status.textContent = n ? `${n} / ${parsed.senses.length} 語義を保存` : '語義を1つ以上選んでください';
  }
  boxes.forEach(({ cb }) => cb.addEventListener('change', refresh));

  const all = el('button', { className: 'oc-link', textContent: 'すべて選択', type: 'button' });
  all.addEventListener('click', () => {
    const turnOn = selected().length < parsed.senses.length;
    boxes.forEach(({ cb }) => { cb.checked = turnOn; });
    all.textContent = turnOn ? 'すべて解除' : 'すべて選択';
    refresh();
  });

  saveBtn.addEventListener('click', () => {
    const senses = selected();
    let payload = { ...parsed, senses };

    let encoded = encodeURIComponent(JSON.stringify(payload));
    /* Safari starts refusing very long addresses. Extra examples are the
     * bulkiest and least essential part, so they go first. */
    if (encoded.length > 60000) {
      payload = { ...payload, senses: senses.map((s) => ({ ...s, extraExamples: [] })) };
      encoded = encodeURIComponent(JSON.stringify(payload));
    }
    if (encoded.length > 120000) {
      status.textContent = '選んだ語義が多すぎます。数を減らしてください。';
      return;
    }

    saveBtn.disabled = true;
    status.textContent = '保存画面を開いています…';
    /* The data rides in the fragment, so it never leaves the device: GitHub
     * Pages only ever sees a request for save.html. */
    location.href = SAVE_URL + '#' + encoded;
  });

  panel.append(
    el('div', { className: 'oc-head' },
      el('b', { textContent: parsed.word }),
      parsed.pos ? el('i', { textContent: parsed.pos }) : null,
      parsed.cefr ? el('b', { className: 'oc-cefr', textContent: parsed.cefr }) : null,
      el('span', { className: 'oc-spacer' }),
      Object.assign(el('button', { className: 'oc-x', textContent: '×', type: 'button' }),
        { onclick: shut })),
    el('div', { className: 'oc-list' }, senseRows),
    status,
    el('div', { className: 'oc-foot' }, all, el('span', { className: 'oc-spacer' }), saveBtn));

  const css = el('style');
  css.textContent = `
    /* Above OALD's own cookie dialog (2147483641), which would otherwise
       cover the panel and make the bookmarklet look broken. */
    #${PANEL}{position:fixed;left:0;right:0;bottom:0;z-index:2147483646;
      max-height:78vh;display:flex;flex-direction:column;
      background:#fff;color:#111827;border-top:3px solid #2563eb;
      border-radius:14px 14px 0 0;box-shadow:0 -6px 28px rgba(0,0,0,.28);
      font:15px/1.5 system-ui,-apple-system,"Segoe UI","Hiragino Sans",sans-serif;
      padding-bottom:env(safe-area-inset-bottom)}
    #${PANEL} .oc-head{display:flex;align-items:baseline;gap:8px;
      padding:13px 16px;border-bottom:1px solid #e5e7eb}
    #${PANEL} .oc-head b{font-size:18px}
    #${PANEL} .oc-head i{color:#6b7280}
    #${PANEL} .oc-spacer{flex:1}
    #${PANEL} .oc-cefr{background:#2563eb;color:#fff;border-radius:3px;
      padding:1px 6px;font-size:11px;font-weight:700}
    #${PANEL} .oc-x{background:none;border:0;font-size:24px;line-height:1;
      color:#6b7280;cursor:pointer;padding:0 4px}
    #${PANEL} .oc-list{overflow-y:auto;padding:6px 10px;-webkit-overflow-scrolling:touch}
    #${PANEL} .oc-sense{display:flex;gap:11px;align-items:flex-start;
      padding:11px 8px;border-bottom:1px solid #f3f4f6;cursor:pointer}
    #${PANEL} .oc-sense input{margin:3px 0 0;width:20px;height:20px;
      accent-color:#2563eb;flex:none}
    #${PANEL} .oc-sense em{display:block;font-style:normal;font-size:11px;
      font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#6b7280}
    #${PANEL} .oc-def{display:block}
    #${PANEL} .oc-msg{margin:0;padding:9px 16px;font-size:13px;color:#6b7280}
    #${PANEL} .oc-foot{display:flex;align-items:center;gap:10px;
      padding:11px 16px 15px;border-top:1px solid #e5e7eb}
    #${PANEL} .oc-foot button{font:inherit;cursor:pointer;border-radius:8px}
    #${PANEL} .oc-link{background:none;border:0;color:#2563eb;font-size:13px;padding:8px 2px}
    #${PANEL} .oc-primary{background:#2563eb;color:#fff;border:0;
      padding:12px 26px;font-weight:700}
    #${PANEL} .oc-primary:disabled{background:#9ca3af}
    @media (prefers-color-scheme:dark){
      #${PANEL}{background:#1b1e25;color:#e8eaed}
      #${PANEL} .oc-head,#${PANEL} .oc-foot{border-color:#2c313a}
      #${PANEL} .oc-sense{border-color:#232830}
    }`;
  panel.prepend(css);

  document.body.append(panel);
  refresh();
})();
