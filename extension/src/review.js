'use strict';

/* Dictionary text is inserted with textContent throughout, never innerHTML. */
function el(tag, props = {}, ...kids) {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids.flat()) {
    if (k == null || k === false) continue;
    n.append(k);
  }
  return n;
}

const fmtDay = (iso) =>
  new Date(iso).toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'
  });

let words = [];

/* The list view can show archived words; review and quiz never do, so they
 * always read from VocabDB directly rather than from this array. */
async function load() {
  const scope = document.getElementById('scope')?.value || 'live';
  words = await VocabDB.getAll({ include: scope });
}

/* ---------- list ---------- */

function playAudio(url) {
  if (url) new Audio(url).play().catch(() => {});
}

/* UK and US buttons for any word that has them; returns [] when it has none,
 * so callers can spread it straight into a node list. */
function audioButtons(w, cls = 'audio') {
  const mk = (label, url) => {
    if (!url) return null;
    const b = el('button', { className: cls, textContent: '\u{1F50A} ' + label, type: 'button' });
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      playAudio(url);
    });
    return b;
  };
  return [mk('UK', w.audio?.br), mk('US', w.audio?.am)].filter(Boolean);
}

function senseNode(s, onRemove) {
  const parts = [s.grammar, s.labels, s.cf].filter(Boolean).join(' ');

  let drop = null;
  if (onRemove) {
    drop = el('button', { className: 'sense-drop', textContent: '×', type: 'button',
      title: 'この語義を保存から外す' });
    drop.addEventListener('click', () => onRemove(s));
  }

  return el('div', { className: 'sense' },
    /* The bold heading OALD groups senses under - "manage", "liquid" - is the
     * quickest way to tell which meaning of a big entry this is. */
    s.shcut || drop
      ? el('div', { className: 'sense-head' },
          s.shcut ? el('span', { className: 'shcut', textContent: s.shcut }) : null,
          el('span', { className: 'spacer' }),
          drop)
      : null,
    el('p', { className: 'def' },
      parts ? el('span', { className: 'lbl', textContent: parts }) : null,
      s.cefr ? el('span', { className: 'cefr', textContent: s.cefr }) : null,
      ' ' + s.def),
    s.examples.length
      ? el('ul', { className: 'ex' }, s.examples.map((x) => el('li', { textContent: x })))
      : null,
    s.collocations.map((c) =>
      el('div', { className: 'collocs' },
        c.heading ? el('b', { textContent: c.heading + ': ' }) : null,
        c.items.map((i) => el('span', { className: 'chip', textContent: i }))))
  );
}

function card(w) {
  const note = el('textarea', {
    className: 'note', rows: 1, value: w.note || '', placeholder: 'メモ'
  });
  note.addEventListener('change', () => VocabDB.update(w.id, { note: note.value.trim() }));

  const refreshList = async () => {
    await load();
    renderList();
  };

  const del = el('button', { className: 'del', textContent: '削除', type: 'button' });
  del.addEventListener('click', async () => {
    if (!confirm(w.word + ' を削除しますか？\nこの操作は取り消せません。')) return;
    await VocabDB.remove(w.id);
    await refreshList();
  });

  const grad = w.archived
    ? el('button', { textContent: '学習に戻す', type: 'button' })
    : el('button', { textContent: 'もう覚えた', type: 'button' });
  grad.addEventListener('click', async () => {
    if (w.archived) await VocabDB.unarchive(w.id);
    else await VocabDB.archive(w.id);
    await refreshList();
  });

  return el('div', { className: 'card' + (w.archived ? ' is-archived' : '') },
    el('div', { className: 'card-head' },
      el('span', { className: 'hw', textContent: w.word }),
      w.archived ? el('span', { className: 'badge', textContent: '卒業' }) : null,
      w.pos ? el('span', { className: 'pos', textContent: w.pos }) : null,
      w.cefr ? el('span', { className: 'cefr', textContent: w.cefr }) : null,
      w.phonetics.br ? el('span', { className: 'phon', textContent: w.phonetics.br }) : null,
      audioButtons(w),
      el('span', { className: 'spacer' }),
      el('span', { className: 'box', textContent: w.srs ? 'box ' + w.srs.box : '' })),
    el('div', { className: 'body' }, w.senses.map((s) =>
      senseNode(s, w.senses.length > 1
        ? async (sense) => {
            await VocabDB.removeSense(w.id, VocabDB.senseKey(sense));
            await refreshList();
          }
        : null))),
    note,
    el('div', { className: 'actions' },
      el('a', { href: w.url, target: '_blank', textContent: 'OALDで開く' }),
      grad,
      del));
}

function matches(w, q) {
  if (!q) return true;
  const hay = [
    w.word, w.note,
    ...w.senses.map((s) => s.def),
    ...w.senses.flatMap((s) => s.examples)
  ].join(' ').toLowerCase();
  return hay.includes(q);
}

function renderList() {
  const q = document.getElementById('filter').value.trim().toLowerCase();
  const lvl = document.getElementById('cefr').value;
  const shown = words.filter((w) => matches(w, q) && (!lvl || w.cefr === lvl));

  document.getElementById('count').textContent = shown.length + ' / ' + words.length + ' 語';

  const box = document.getElementById('list');
  box.textContent = '';

  if (!shown.length) {
    box.append(el('p', {
      className: 'empty',
      textContent: words.length
        ? '該当する単語がありません。'
        : 'まだ保存された単語がありません。OALDで単語を開いて「この単語を保存」を押してください。'
    }));
    return;
  }

  /* Saved-on date drives the grouping, so the list reads as a study diary. */
  let lastDay = null;
  for (const w of shown) {
    const day = fmtDay(w.savedAt);
    if (day !== lastDay) {
      box.append(el('div', { className: 'date-group', textContent: day }));
      lastDay = day;
    }
    box.append(card(w));
  }
}

/* ---------- review ---------- */

let queue = [];

async function startReview() {
  queue = await VocabDB.due();
  await renderAttention();
  renderCard();
}

/* Words saved two months ago that were never graduated. Kept in their own
 * space in the review screen rather than deleted: two months without sticking
 * is the signal to look again, not to throw away. */
async function renderAttention() {
  const list = await VocabDB.needsAttention();
  const box = document.getElementById('attention');
  box.hidden = list.length === 0;
  if (!list.length) return;

  document.getElementById('attention-count').textContent =
    `${list.length} 語 · 保存から ${VocabDB.ATTENTION_DAYS} 日以上`;

  const body = document.getElementById('attention-body');
  body.textContent = '';
  for (const w of list) body.append(card(w));
}

document.getElementById('attention-toggle').addEventListener('click', (e) => {
  const body = document.getElementById('attention-body');
  body.hidden = !body.hidden;
  e.target.textContent = body.hidden ? '開く' : '閉じる';
});

function renderCard() {
  const host = document.getElementById('card-area');
  host.textContent = '';
  const area = el('div', { className: 'card-area' });
  host.append(area);

  if (!queue.length) {
    area.append(el('p', {
      className: 'empty',
      textContent: '今復習する単語はありません。おつかれさまでした。'
    }));
    return;
  }

  const w = queue[0];
  area.append(el('div', { className: 'progress', textContent: '残り ' + queue.length + ' 語' }));

  const flash = el('div', { className: 'flash' },
    el('div', { className: 'hw', textContent: w.word }),
    w.phonetics.br ? el('div', { className: 'phon', textContent: w.phonetics.br }) : null);
  area.append(flash);

  const reveal = el('button', { className: 'reveal', textContent: '答えを見る', type: 'button' });
  const wrap = el('div', { className: 'grade' }, reveal);
  area.append(wrap);

  reveal.addEventListener('click', () => {
    /* Many words spell BrE and AmE identically; showing the second one then
     * just looks like a duplicate of the line above. */
    const amDiffers = w.phonetics.am && w.phonetics.am !== w.phonetics.br;
    flash.append(
      el('div', { className: 'pron-row' },
        amDiffers ? el('span', { className: 'phon', textContent: w.phonetics.am }) : null,
        audioButtons(w, 'audio big')),
      el('div', { className: 'answer' }, w.senses.map(senseNode)));
    wrap.textContent = '';
    /* These two only score this attempt and move the Leitner box. Retiring a
     * word is a separate, deliberate button so one lucky recall cannot
     * graduate it. */
    const mk = (cls, label, ok) => {
      const b = el('button', { className: cls, textContent: label, type: 'button' });
      b.addEventListener('click', async () => {
        await VocabDB.grade(w.id, ok);
        queue.shift();
        await load();
        renderCard();
      });
      return b;
    };
    wrap.append(mk('no', 'できなかった', false), mk('yes', 'できた', true));

    const grad = el('button', { className: 'graduate', textContent: 'もう覚えた（卒業）',
      type: 'button' });
    grad.addEventListener('click', async () => {
      await VocabDB.archive(w.id);
      queue.shift();
      await load();
      renderCard();
    });
    area.append(el('div', { className: 'grade secondary' }, grad));
  });
}

/* ---------- quiz ---------- */

const QUIZ_MODES_KEY = 'quizModes';
let session = null;

/* Everything except the audio and illustration modes works with no connection,
 * so the quiz stays usable on a train - it just offers fewer formats. */
const isOnline = () => navigator.onLine;

/* Speech input is treated as another way to fill the text box, not as its own
 * mode, so an unsupported browser simply loses the mic button. */
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

function micButton(input, onFinal) {
  if (!SpeechRec) return null;
  const b = el('button', { className: 'mic', textContent: '\u{1F3A4}', type: 'button',
    title: '発音して答える' });
  b.addEventListener('click', () => {
    const rec = new SpeechRec();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 3;
    b.classList.add('listening');
    rec.onresult = (e) => {
      const alts = [...e.results[0]].map((r) => r.transcript.trim());
      input.value = alts[0] || '';
      onFinal?.(alts);
    };
    rec.onerror = (e) => {
      b.classList.remove('listening');
      b.title = e.error === 'not-allowed'
        ? 'マイクの使用が許可されていません'
        : '音声認識に失敗しました: ' + e.error;
    };
    rec.onend = () => b.classList.remove('listening');
    try { rec.start(); } catch { b.classList.remove('listening'); }
  });
  return b;
}

function renderSetup(available, chosen) {
  const box = document.getElementById('modes');
  box.textContent = '';
  for (const m of available) {
    const id = 'm-' + m.id;
    const cb = el('input', { type: 'checkbox', id, checked: chosen.includes(m.id) });
    cb.disabled = m.usable === 0;
    cb.addEventListener('change', () => {
      /* Only remember modes the learner actually unticked, so a format that is
       * merely offline right now comes back next time they are connected. */
      const now = [...box.querySelectorAll('input:checked')].map((i) => i.id.slice(2));
      localStorage.setItem(QUIZ_MODES_KEY, JSON.stringify(now));
    });

    const why = m.offlineBlocked
      ? 'オフラインでは利用できません'
      : m.usable ? m.hint : '対象の単語がありません';

    box.append(el('label', { className: 'mode' + (m.usable ? '' : ' off'), htmlFor: id },
      cb,
      el('span', {},
        el('b', { textContent: m.label }),
        el('small', { textContent: why })),
      el('span', { className: 'usable',
        textContent: m.offlineBlocked ? 'オフライン' : m.usable + ' 語' })));
  }
}

/* Always the live set: the list view's scope selector must not leak graduated
 * words back into the quiz. */
let quizPool = [];

async function setupQuiz() {
  quizPool = await VocabDB.getAll();
  const available = Quiz.availability(quizPool, isOnline());
  let chosen;
  try {
    chosen = JSON.parse(localStorage.getItem(QUIZ_MODES_KEY)) || null;
  } catch { chosen = null; }
  if (!chosen) chosen = available.filter((m) => m.usable).map((m) => m.id);
  renderSetup(available, chosen);

  const offline = available.filter((m) => m.offlineBlocked).length;
  const banner = document.getElementById('offline-note');
  banner.hidden = isOnline();
  banner.textContent = `オフラインです。${offline} 形式（音声・イラスト）は利用できません。`
    + '他の形式はそのまま使えます。';

  document.getElementById('quiz-setup').hidden = false;
  document.getElementById('quiz-area').hidden = true;
}

/* The connection can come and go while the page is open. */
for (const ev of ['online', 'offline']) {
  window.addEventListener(ev, () => {
    if (document.getElementById('view-quiz').hidden) return;
    if (document.getElementById('quiz-setup').hidden) renderQuestion();
    else setupQuiz();
  });
}

function startQuiz() {
  const modes = [...document.querySelectorAll('#modes input:checked')].map((i) => i.id.slice(2));
  const count = Math.max(1, Number(document.getElementById('qcount').value) || 10);
  const questions = Quiz.build(quizPool, modes, count, { online: isOnline() });
  if (!questions.length) {
    alert('出題できる問題がありませんでした。単語をもう少し保存するか、形式を増やしてください。');
    return;
  }
  session = { questions, i: 0, right: 0, wrong: [] };
  document.getElementById('quiz-setup').hidden = true;
  document.getElementById('quiz-area').hidden = false;
  renderQuestion();
}

function promptNode(q) {
  switch (q.promptKind) {
    case 'def':
      return el('div', { className: 'q-def', textContent: q.prompt });
    case 'word':
      return el('div', { className: 'hw', textContent: q.prompt });
    case 'sentence':
      return el('div', { className: 'q-sentence', textContent: q.prompt });
    case 'colloc':
      return el('div', {},
        el('div', { className: 'q-label', textContent: q.sub }),
        el('div', { className: 'hw', textContent: q.prompt }));
    case 'image': {
      /* Fall back to the thumbnail once, then give up gracefully - both are
       * remote URLs, so a broken full-size image often means no connection
       * rather than a missing file. */
      const img = el('img', { className: 'q-image', src: q.image.full, alt: '' });
      let tried = false;
      img.addEventListener('error', () => {
        if (!tried && q.image.thumb && q.image.thumb !== q.image.full) {
          tried = true;
          img.src = q.image.thumb;
          return;
        }
        img.replaceWith(el('div', { className: 'q-broken',
          textContent: '画像を読み込めませんでした' }));
      });
      return img;
    }
    case 'audio':
      return el('div', { className: 'q-audio' }, audioButtons(q.word, 'audio big'));
    default:
      return el('div', {});
  }
}

async function finishQuestion(q, ok, area, detail) {
  await VocabDB.grade(q.word.id, ok);
  if (ok) session.right++;
  else session.wrong.push(q);

  const foot = el('div', { className: 'q-foot' },
    el('div', { className: 'verdict ' + (ok ? 'ok' : 'ng'),
      textContent: ok ? '正解' : '不正解' }),
    detail || null,
    el('div', { className: 'pron-row' },
      el('span', { className: 'hw small', textContent: q.word.word }),
      q.word.phonetics.br ? el('span', { className: 'phon', textContent: q.word.phonetics.br }) : null,
      audioButtons(q.word, 'audio big')),
    el('div', { className: 'q-model', textContent: (q.word.senses[0] || {}).def || '' }));

  const advance = async () => {
    session.i++;
    quizPool = await VocabDB.getAll();
    await load();
    renderQuestion();
  };

  const next = el('button', { className: 'reveal', textContent: '次へ', type: 'button' });
  next.addEventListener('click', advance);

  /* Offered right where the learner just proved they knew it. */
  const grad = el('button', { className: 'graduate', textContent: 'もう覚えた（卒業）',
    type: 'button' });
  grad.addEventListener('click', async () => {
    await VocabDB.archive(q.word.id);
    await advance();
  });

  foot.append(el('div', { className: 'grade' }, next),
    el('div', { className: 'grade secondary' }, grad));
  area.append(foot);
  next.focus();
}

function renderQuestion() {
  const host = document.getElementById('quiz-area');
  host.textContent = '';

  if (session.i >= session.questions.length) return renderQuizResult(host);

  const q = session.questions[session.i];
  const area = el('div', { className: 'card-area' });
  host.append(area);

  area.append(el('div', { className: 'progress',
    textContent: `${session.i + 1} / ${session.questions.length}　正解 ${session.right}` }));

  /* The connection dropped after this question was generated. Skipping without
   * scoring is fairer than marking a question that cannot be answered. */
  if (Quiz.unanswerableOffline(q, isOnline())) {
    area.append(el('div', { className: 'flash quiz' },
      el('div', { className: 'q-mode',
        textContent: (Quiz.MODES.find((m) => m.id === q.mode) || {}).label || '' }),
      el('div', { className: 'q-broken',
        textContent: q.promptKind === 'audio'
          ? 'オフラインのため音声を再生できません'
          : 'オフラインのためイラストを表示できません' }),
      el('div', { className: 'q-sub', textContent: '採点せずに次へ進みます' })));

    const skip = el('button', { className: 'reveal', textContent: 'スキップ', type: 'button' });
    skip.addEventListener('click', () => {
      session.questions.splice(session.i, 1);
      renderQuestion();
    });
    area.append(el('div', { className: 'grade' }, skip));
    skip.focus();
    return;
  }

  const modeLabel = (Quiz.MODES.find((m) => m.id === q.mode) || {}).label || '';
  const flash = el('div', { className: 'flash quiz' },
    el('div', { className: 'q-mode', textContent: modeLabel }),
    promptNode(q),
    q.sub && q.promptKind !== 'colloc'
      ? el('div', { className: 'q-sub', textContent: q.sub }) : null);
  area.append(flash);

  if (q.autoplay) playAudio(q.word.audio.br || q.word.audio.am);

  if (q.kind === 'choice') {
    const wrap = el('div', { className: 'choices' });
    for (const c of q.choices) {
      const b = el('button', { className: 'choice', textContent: c.text, type: 'button' });
      b.addEventListener('click', () => {
        wrap.querySelectorAll('button').forEach((x) => { x.disabled = true; });
        wrap.querySelectorAll('button').forEach((x, idx) => {
          if (q.choices[idx].correct) x.classList.add('is-correct');
        });
        if (!c.correct) b.classList.add('is-wrong');
        finishQuestion(q, c.correct, area);
      });
      wrap.append(b);
    }
    area.append(wrap);
    return;
  }

  if (q.kind === 'input') {
    const input = el('input', { className: 'answer-input', type: 'text',
      placeholder: '答えを入力', autocomplete: 'off', spellcheck: false });
    const submit = el('button', { className: 'reveal', textContent: '判定', type: 'button' });
    const row = el('div', { className: 'input-row' }, input, micButton(input), submit);
    area.append(row);
    input.focus();

    const check = () => {
      const r = Quiz.gradeInput(input.value, q.answer);
      input.disabled = true;
      submit.disabled = true;
      input.classList.add(r.verdict === 'wrong' ? 'is-wrong' : 'is-correct');
      /* A single typo still counts, but say so rather than silently passing. */
      const detail = el('div', { className: 'q-detail' },
        r.verdict === 'close' ? 'つづり惜しい: ' : '正解: ',
        el('b', { textContent: q.answer }));
      finishQuestion(q, r.verdict !== 'wrong', area, detail);
    };
    submit.addEventListener('click', check);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
    return;
  }

  /* kind === 'self': the learner marks their own free-text definition. */
  const ta = el('textarea', { className: 'answer-input', rows: 3,
    placeholder: '英語で意味を説明してみる' });
  const show = el('button', { className: 'reveal', textContent: '模範解答を見る', type: 'button' });
  area.append(el('div', { className: 'input-row' }, ta), el('div', { className: 'grade' }, show));
  ta.focus();

  show.addEventListener('click', () => {
    ta.disabled = true;
    show.remove();
    const ov = Quiz.overlap(ta.value, q.model);
    const detail = el('div', { className: 'q-detail' },
      el('div', { textContent: `キーワード一致 ${ov.hit.length} / ${ov.hit.length + ov.miss.length}` }),
      el('div', {}, ov.hit.map((k) => el('span', { className: 'chip hit', textContent: k })),
        ov.miss.map((k) => el('span', { className: 'chip miss', textContent: k }))));
    area.append(el('div', { className: 'q-model-box' },
      el('div', { className: 'q-label', textContent: '模範解答（OALD）' }),
      el('div', { textContent: q.model }), detail));

    const mk = (cls, label, ok) => {
      const b = el('button', { className: cls, textContent: label, type: 'button' });
      b.addEventListener('click', () => { grades.remove(); finishQuestion(q, ok, area); });
      return b;
    };
    const grades = el('div', { className: 'grade' },
      mk('no', '書けなかった', false), mk('yes', '書けた', true));
    area.append(grades);
  });
}

function renderQuizResult(host) {
  const pct = Math.round((session.right / session.questions.length) * 100);
  const area = el('div', { className: 'card-area' },
    el('div', { className: 'flash' },
      el('div', { className: 'hw', textContent: `${session.right} / ${session.questions.length}` }),
      el('div', { className: 'q-sub', textContent: `正答率 ${pct}%` })));
  host.append(area);

  if (session.wrong.length) {
    area.append(el('div', { className: 'q-label', textContent: '間違えた単語' }));
    const seen = new Set();
    for (const q of session.wrong) {
      if (seen.has(q.word.id)) continue;
      seen.add(q.word.id);
      area.append(card(q.word));
    }
  }
  const again = el('button', { className: 'reveal', textContent: 'もう一度', type: 'button' });
  again.addEventListener('click', () => setupQuiz());
  area.append(el('div', { className: 'grade' }, again));
}

/* ---------- shell ---------- */

function show(view) {
  document.querySelectorAll('.tab').forEach((t) =>
    t.classList.toggle('is-active', t.dataset.view === view));
  document.getElementById('view-list').hidden = view !== 'list';
  document.getElementById('view-review').hidden = view !== 'review';
  document.getElementById('view-quiz').hidden = view !== 'quiz';
  if (view === 'review') startReview();
  else if (view === 'quiz') setupQuiz();
  else renderList();
}

document.getElementById('start-quiz').addEventListener('click', startQuiz);

document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => show(t.dataset.view)));

document.getElementById('filter').addEventListener('input', renderList);
document.getElementById('cefr').addEventListener('change', renderList);
document.getElementById('scope').addEventListener('change', async () => {
  await load();
  renderList();
});

document.getElementById('export').addEventListener('click', async () => {
  const blob = new Blob([await VocabDB.exportJSON()], { type: 'application/json' });
  const stamp = new Date().toISOString().slice(0, 10);
  const a = el('a', { href: URL.createObjectURL(blob), download: 'oald-vocab-' + stamp + '.json' });
  a.click();
  URL.revokeObjectURL(a.href);
});

const file = document.getElementById('file');
document.getElementById('import').addEventListener('click', () => file.click());
file.addEventListener('change', async () => {
  const f = file.files[0];
  if (!f) return;
  try {
    const r = await VocabDB.importJSON(await f.text());
    alert('読み込みました。\n新規 ' + r.added + ' 語 / 更新 ' + r.updated + ' 語 / 合計 ' + r.total + ' 語');
    await load();
    renderList();
  } catch (e) {
    alert('読み込みに失敗しました: ' + e.message);
  }
  file.value = '';
});

const START_VIEW = { '#review': 'review', '#quiz': 'quiz' };

(async () => {
  await load();
  show(START_VIEW[location.hash] || 'list');
})();
