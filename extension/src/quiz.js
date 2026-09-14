/*
 * Question generation and answer grading.
 *
 * Every mode is a plain object with `needs(word, pool)` and `build(word, pool)`,
 * so adding a question type later means appending one entry to MODES.
 * Questions are data only - review.js decides how to draw them.
 */
(function (global) {
  'use strict';

  /* ---------- helpers ---------- */

  const shuffle = (a) => {
    const r = a.slice();
    for (let i = r.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [r[i], r[j]] = [r[j], r[i]];
    }
    return r;
  };

  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  const firstSense = (w) => (w.senses && w.senses[0]) || null;
  const defOf = (w) => firstSense(w)?.def || '';

  const norm = (s) =>
    (s || '').toLowerCase().replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ').trim();

  /* Matches the headword and its regular inflections inside an example. */
  function inflections(word) {
    const stem = word.replace(/[^a-zA-Z]/g, '');
    if (!stem) return null;
    const base = stem.replace(/e$/i, '');
    return new RegExp('\\b' + base + '(?:e|es|ed|ing|s|ies|ied)?\\b', 'gi');
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length;
    const n = b.length;
    if (!m || !n) return m || n;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(
          prev[j] + 1,
          cur[j - 1] + 1,
          prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
      prev = cur;
    }
    return prev[n];
  }

  /* Distractors that are plausible: same part of speech first, then same CEFR
   * level, then anything. A quiz whose wrong answers are obviously wrong
   * teaches nothing. */
  function distractors(target, pool, n, valueOf) {
    const others = pool.filter((w) => w.id !== target.id && valueOf(w));
    const tiers = [
      others.filter((w) => w.pos === target.pos && w.cefr === target.cefr),
      others.filter((w) => w.pos === target.pos),
      others
    ];
    const out = [];
    const seen = new Set([valueOf(target)]);
    for (const tier of tiers) {
      for (const w of shuffle(tier)) {
        if (out.length >= n) break;
        const v = valueOf(w);
        if (seen.has(v)) continue;
        seen.add(v);
        out.push(w);
      }
      if (out.length >= n) break;
    }
    return out;
  }

  function choiceQuestion(target, pool, valueOf, extra) {
    const wrong = distractors(target, pool, 3, valueOf);
    if (wrong.length < 3) return null;
    const choices = shuffle([
      { text: valueOf(target), correct: true },
      ...wrong.map((w) => ({ text: valueOf(w), correct: false }))
    ]);
    return { kind: 'choice', word: target, choices, ...extra };
  }

  /* ---------- modes ---------- */

  const MODES = [
    {
      id: 'def2word',
      label: '意味 → 単語（4択）',
      hint: '英英の語義を読んで単語を選ぶ',
      needs: (w, pool) => defOf(w) && pool.length >= 4,
      build: (w, pool) =>
        choiceQuestion(w, pool, (x) => x.word, {
          mode: 'def2word',
          prompt: defOf(w),
          promptKind: 'def',
          sub: [firstSense(w).grammar, firstSense(w).labels].filter(Boolean).join(' ')
        })
    },
    {
      id: 'word2def',
      label: '単語 → 意味（4択）',
      hint: '単語を見て最も近い語義を選ぶ',
      needs: (w, pool) => defOf(w) && pool.length >= 4,
      build: (w, pool) =>
        choiceQuestion(w, pool, defOf, {
          mode: 'word2def',
          prompt: w.word,
          promptKind: 'word'
        })
    },
    {
      id: 'def2spell',
      label: '意味 → 単語を入力',
      hint: 'つづりを打つ。マイクで発音入力もできる',
      needs: (w) => !!defOf(w),
      build: (w) => ({
        kind: 'input',
        mode: 'def2spell',
        word: w,
        prompt: defOf(w),
        promptKind: 'def',
        /* First letter and length keep this recall-with-a-nudge rather than
         * an impossible blank. */
        sub: w.word[0] + ' ' + '_ '.repeat(Math.max(w.word.length - 1, 0)).trim(),
        answer: w.word,
        speech: true
      })
    },
    {
      id: 'cloze',
      label: '例文の穴埋め',
      hint: '保存した例文から単語を隠して出題',
      needs: (w) => !!clozeSource(w),
      build: (w) => {
        const src = clozeSource(w);
        return {
          kind: 'input',
          mode: 'cloze',
          word: w,
          prompt: src.blanked,
          promptKind: 'sentence',
          sub: defOf(w),
          answer: src.hidden,
          speech: true
        };
      }
    },
    {
      id: 'listen',
      label: '音声 → 単語を入力',
      hint: 'UK/US の発音を聞いてつづりを打つ',
      needsNetwork: true,
      needs: (w) => !!(w.audio && (w.audio.br || w.audio.am)),
      build: (w) => ({
        kind: 'input',
        mode: 'listen',
        word: w,
        prompt: '',
        promptKind: 'audio',
        sub: '',
        answer: w.word,
        autoplay: true
      })
    },
    {
      id: 'colloc',
      label: 'コロケーション（4択）',
      hint: 'その単語と結びつく語を選ぶ',
      needs: (w, pool) => collocPairs(w).length > 0 && pool.length >= 4,
      build: (w, pool) => {
        const pair = pick(collocPairs(w));
        const mine = new Set(collocPairs(w).map((p) => p.item.toLowerCase()));
        const seen = new Set([pair.item.toLowerCase()]);
        const wrong = [];

        /* Prefer distractors from the same kind of slot in other words, so only
         * usage separates the choices. Fall back to any other collocation
         * rather than dropping the question entirely. */
        const harvest = (sameKind) => {
          for (const other of shuffle(pool)) {
            if (other.id === w.id || wrong.length >= 3) break;
            for (const p of shuffle(collocPairs(other))) {
              if (sameKind && p.kind !== pair.kind) continue;
              const key = p.item.toLowerCase();
              /* Never offer a word's own collocation as a wrong answer. */
              if (seen.has(key) || mine.has(key)) continue;
              seen.add(key);
              wrong.push(p.item);
              break;
            }
          }
        };
        harvest(true);
        if (wrong.length < 3) harvest(false);
        if (wrong.length < 3) return null;
        return {
          kind: 'choice',
          mode: 'colloc',
          word: w,
          prompt: w.word,
          promptKind: 'colloc',
          sub: pair.heading,
          choices: shuffle([
            { text: pair.item, correct: true },
            ...wrong.map((t) => ({ text: t, correct: false }))
          ])
        };
      }
    },
    {
      id: 'image',
      label: 'イラスト → 単語（4択）',
      hint: 'OALD の挿絵がある単語のみ',
      needsNetwork: true,
      needs: (w, pool) => !!(w.image && w.image.thumb) && pool.length >= 4,
      build: (w, pool) =>
        choiceQuestion(w, pool, (x) => x.word, {
          mode: 'image',
          prompt: '',
          promptKind: 'image',
          image: w.image
        })
    },
    {
      id: 'word2free',
      label: '単語 → 意味を記述（自己採点）',
      hint: '英語で説明を書き、模範解答と見比べる',
      needs: (w) => !!defOf(w),
      build: (w) => ({
        kind: 'self',
        mode: 'word2free',
        word: w,
        prompt: w.word,
        promptKind: 'word',
        model: defOf(w)
      })
    }
  ];

  function clozeSource(w) {
    if (!inflections(w.word)) return null;
    /* A fresh regex per test: /g regexes carry lastIndex between calls. */
    const hits = (ex) => inflections(w.word).test(ex);
    const pool = [
      ...(w.senses || []).flatMap((s) => [...(s.examples || []), ...(s.extraExamples || [])]),
      ...(w.extraExamples || []) // records written before senses carried their own
    ].filter((ex) => ex.length > 15 && ex.length < 160 && hits(ex));
    if (!pool.length) return null;
    const sentence = pick(pool);
    let hidden = '';
    const blanked = sentence.replace(inflections(w.word), (m) => {
      if (!hidden) hidden = m;
      return ' _____ ';
    });
    return hidden ? { blanked, hidden } : null;
  }

  /* OALD writes headings like "verb + argument" or "kitchen + noun", which
   * never match across words. Swapping the headword for "~" makes the category
   * comparable, so distractors can be drawn from the same kind of slot. */
  function collocPairs(w) {
    const re = new RegExp(w.word.replace(/[^a-zA-Z]/g, ''), 'ig');
    return (w.senses || []).flatMap((s) =>
      (s.collocations || []).flatMap((c) => {
        const heading = c.heading || '';
        const kind = heading.replace(re, '~').toLowerCase().trim();
        return (c.items || []).map((item) => ({ heading, kind, item }));
      })
    );
  }

  /* ---------- building a session ---------- */

  /* Audio and illustrations are stored as OALD URLs, not as files, so those two
   * modes can only produce answerable questions while there is a connection. */
  const blocked = (m, online) => !online && m.needsNetwork;

  function build(words, modeIds, count, { online = true } = {}) {
    const pool = words;
    const modes = MODES.filter((m) => modeIds.includes(m.id) && !blocked(m, online));
    if (!modes.length || !pool.length) return [];

    const questions = [];
    const used = new Set();

    /* Each pass asks every word at most once, so a small collection still
     * fills a long session by cycling through the other question formats
     * instead of stopping at one question per word. */
    for (let pass = 0; pass < modes.length && questions.length < count; pass++) {
      for (const w of shuffle(pool)) {
        if (questions.length >= count) break;
        const fresh = shuffle(
          modes.filter((m) => !used.has(w.id + '|' + m.id) && m.needs(w, pool))
        );
        for (const m of fresh) {
          const q = m.build(w, pool);
          if (!q) continue;
          used.add(w.id + '|' + m.id);
          questions.push(q);
          break;
        }
      }
    }
    return shuffle(questions).slice(0, count);
  }

  /* Which modes can actually produce a question from this collection, right
   * now. A mode blocked by being offline reports zero rather than handing out
   * questions nobody can answer. */
  function availability(words, online = true) {
    return MODES.map((m) => ({
      ...m,
      offlineBlocked: blocked(m, online),
      usable: blocked(m, online) ? 0 : words.filter((w) => m.needs(w, words)).length
    }));
  }

  /* True for a question that has become unanswerable since it was generated -
   * the connection dropped part-way through a session. */
  function unanswerableOffline(q, online = true) {
    return !online && (q.promptKind === 'audio' || q.promptKind === 'image');
  }

  /* ---------- grading ---------- */

  const STOP = new Set(
    ('a an the of to in on at for with by or and that this these those is are was were be ' +
     'been being as from it its you your they their he she his her not no if than then so ' +
     'such some any other more most very can will would should could may might do does did')
      .split(' ')
  );

  function keywords(text) {
    return new Set(norm(text).split(' ').filter((t) => t.length > 2 && !STOP.has(t)));
  }

  /* Typed answers: exact after normalising, "close" when a single typo apart. */
  function gradeInput(given, answer) {
    const g = norm(given);
    const a = norm(answer);
    if (!g) return { verdict: 'wrong', distance: Infinity };
    if (g === a) return { verdict: 'correct', distance: 0 };
    const d = levenshtein(g, a);
    if (d <= (a.length > 6 ? 2 : 1)) return { verdict: 'close', distance: d };
    return { verdict: 'wrong', distance: d };
  }

  /* Free-form definitions are NOT auto-marked. Overlap is shown only as a cue
   * for the learner's own judgement - see word2free. */
  function overlap(given, model) {
    const g = keywords(given);
    const m = keywords(model);
    if (!m.size) return { hit: [], miss: [], ratio: 0 };
    const hit = [...m].filter((k) => g.has(k));
    return { hit, miss: [...m].filter((k) => !g.has(k)), ratio: hit.length / m.size };
  }

  global.Quiz = {
    MODES, build, availability, unanswerableOffline, gradeInput, overlap, shuffle
  };
})(typeof window !== 'undefined' ? window : self);
