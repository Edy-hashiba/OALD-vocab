/* Injects the save bar at the top of an OALD definition page, plus a save
 * control on each individual sense. */
(function () {
  'use strict';

  const BAR_ID = 'oald-vocab-bar';
  if (document.getElementById(BAR_ID)) return;

  const parsed = window.OALDParser.parse();
  if (!parsed) return;

  const key = (s) => s.key || s.def;

  const fmtDate = (iso) =>
    new Date(iso).toLocaleDateString('ja-JP', {
      year: 'numeric', month: 'long', day: 'numeric'
    });

  const bar = document.createElement('div');
  bar.id = BAR_ID;
  bar.innerHTML = `
    <div class="ovb-inner">
      <div class="ovb-word">
        <strong></strong>
        <span class="ovb-pos"></span>
        <span class="ovb-cefr"></span>
      </div>
      <div class="ovb-status"></div>
      <input class="ovb-note" type="text" placeholder="メモ（任意）" />
      <button class="ovb-save" type="button"></button>
      <button class="ovb-open" type="button">復習リスト</button>
    </div>`;
  document.body.prepend(bar);

  bar.querySelector('strong').textContent = parsed.word;
  bar.querySelector('.ovb-pos').textContent = parsed.pos || '';
  const cefrEl = bar.querySelector('.ovb-cefr');
  if (parsed.cefr) cefrEl.textContent = parsed.cefr;
  else cefrEl.remove();

  const saveBtn = bar.querySelector('.ovb-save');
  const statusEl = bar.querySelector('.ovb-status');
  const noteEl = bar.querySelector('.ovb-note');

  /* The page scrolls under a fixed bar, so give the body room for it. */
  const prevPadding = document.body.style.paddingTop;
  document.body.style.paddingTop = `calc(${prevPadding || '0px'} + 52px)`;

  /* ---------- per-sense controls ----------
   * An entry like "run" has 39 senses and only one of them is the reason for
   * the visit. Rather than making the learner pick from a list afterwards, a
   * checkbox sits on the sense they are already reading. */

  const senseBoxes = new Map();

  /* Only worth offering when there is actually a choice to make. */
  const multiSense = parsed.senses.length > 1;

  function attachSenseBoxes() {
    if (!multiSense) return;
    for (const s of parsed.senses) {
      const li = s.key && document.getElementById(s.key);
      if (!li || li.querySelector('.ovb-sense-pick')) continue;

      const cb = document.createElement('input');
      cb.type = 'checkbox';

      const label = document.createElement('label');
      label.className = 'ovb-sense-pick';
      label.append(cb, document.createElement('span'));

      /* Ticking saves straight away: a separate "apply" step is one more thing
       * to forget, and every change here is trivially reversible. */
      cb.addEventListener('change', async () => {
        cb.disabled = true;
        try {
          if (cb.checked) {
            await VocabDB.save(parsed, [key(s)]);
          } else {
            const saved = await VocabDB.get(parsed.id);
            const rest = (saved?.senses || []).filter((x) => key(x) !== key(s));
            /* Unticking the last one means nothing is saved any more. */
            if (rest.length) await VocabDB.removeSense(parsed.id, key(s));
            else await VocabDB.remove(parsed.id);
          }
          await refresh();
        } finally {
          cb.disabled = false;
        }
      });

      li.prepend(label);
      senseBoxes.set(key(s), { cb, label });
    }
  }

  function renderSenseBoxes(savedKeys) {
    for (const [k, { cb, label }] of senseBoxes) {
      const on = savedKeys.has(k);
      cb.checked = on;
      label.classList.toggle('is-saved', on);
      label.querySelector('span').textContent = on ? '保存済み' : 'この語義を保存';
    }
  }

  /* ---------- top bar ---------- */

  function render(saved) {
    const savedKeys = new Set((saved?.senses || []).map(key));
    renderSenseBoxes(savedKeys);

    const total = parsed.senses.length;
    const n = savedKeys.size;

    if (n) {
      bar.classList.add('is-saved');
      statusEl.textContent =
        `${n}/${total} 語義を保存中 · ${fmtDate(saved.savedAt)}`;
      if (document.activeElement !== noteEl) noteEl.value = saved.note || '';
    } else {
      bar.classList.remove('is-saved');
      statusEl.textContent = `${total} 語義 · ${parsed.image ? '挿絵あり · ' : ''}未保存`;
    }

    /* Saving everything stays one click away, but the count makes it clear
     * what that means on a big entry. */
    const missing = total - n;
    saveBtn.textContent = missing
      ? (n ? `残り${missing}語義も保存` : `すべて保存 (${total})`)
      : 'メモを更新';
    saveBtn.disabled = false;
  }

  async function refresh() {
    render(await VocabDB.get(parsed.id));
  }

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      await VocabDB.save(parsed);
      if (noteEl.value.trim()) await VocabDB.update(parsed.id, { note: noteEl.value.trim() });
      bar.classList.add('just-saved');
      setTimeout(() => bar.classList.remove('just-saved'), 900);
      await refresh();
    } finally {
      saveBtn.disabled = false;
    }
  });

  /* Let the note be edited without re-clicking save. */
  noteEl.addEventListener('change', async () => {
    if (await VocabDB.has(parsed.id)) {
      await VocabDB.update(parsed.id, { note: noteEl.value.trim() });
    }
  });

  bar.querySelector('.ovb-open').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_REVIEW' });
  });

  attachSenseBoxes();
  refresh();
})();
