/*
 * Extracts a structured word record from a live OALD definition page.
 * Runs as a content script, so it sees the DOM after the site's own JS has run
 * (collapsed boxes are present in the DOM even while visually hidden).
 */
(function () {
  'use strict';

  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

  // Sense-level examples live in .examples too, but so do the "Extra Examples"
  // boxes. Anything inside an .unbox belongs to a box, not to the sense.
  const inBox = (el) => !!el.closest('.unbox');

  function cefrOf(root) {
    const sym = root.querySelector('[class*="ox3ksym_"]');
    if (!sym) return '';
    const m = /ox3ksym_([a-c][12])/.exec(sym.className);
    return m ? m[1].toUpperCase() : '';
  }

  function collocationsIn(sense) {
    const out = [];
    sense.querySelectorAll('.collocs_list').forEach((ul) => {
      const heading = txt(
        ul.closest('.collocs_gp')?.querySelector('.collocs_title') ||
        ul.previousElementSibling
      );
      const items = [...ul.querySelectorAll('li')]
        .map(txt)
        .filter((t) => t && t !== '…');
      if (items.length) out.push({ heading, items });
    });
    return out;
  }

  function parseSense(li) {
    const examples = [...li.querySelectorAll('.examples > li')]
      .filter((ex) => !inBox(ex))
      .map((ex) => txt(ex))
      .filter(Boolean);

    const def = txt(li.querySelector('.def'));

    return {
      /* OALD gives each sense a stable id ("run_sng_7"). It is what lets a
       * second visit add a sense without duplicating the ones already saved. */
      key: li.id || def.slice(0, 60),
      num: li.getAttribute('sensenum') || '',
      /* The bold heading a group of senses sits under ("manage", "liquid"). */
      shcut: txt(li.closest('.shcut-g')?.querySelector('.shcut')),
      def,
      cefr: (li.getAttribute('cefr') || txt(li.querySelector('.topic_cefr'))).toUpperCase(),
      grammar: txt(li.querySelector('.grammar')),
      labels: txt(li.querySelector('.labels')),
      cf: txt(li.querySelector('.cf')),
      examples,
      /* Extra examples hang inside their own sense, so they travel with it. */
      extraExamples: [...li.querySelectorAll('.unbox[unbox="extra_examples"] .examples li')]
        .map(txt)
        .filter(Boolean),
      collocations: collocationsIn(li)
    };
  }

  function parse() {
    const entry = document.querySelector('#entryContent .entry, .entry');
    if (!entry) return null;

    const webtop = entry.querySelector('.webtop') || entry;
    const word = txt(webtop.querySelector('.headword'));
    if (!word) return null;

    const pos = txt(webtop.querySelector('.pos'));

    const senseNodes = [...entry.querySelectorAll('li.sense')];
    const single = entry.querySelector('.sense_single');
    const senses = (senseNodes.length ? senseNodes : single ? [single] : [])
      .map(parseSense)
      .filter((s) => s.def);

    /* Kept only so records written before senses carried their own extra
     * examples still render; new saves leave it empty. */
    const extraExamples = [];

    const idioms = [...entry.querySelectorAll('.idioms .idm-g')].map((g) => ({
      idiom: txt(g.querySelector('.idm')),
      def: txt(g.querySelector('.def')),
      examples: [...g.querySelectorAll('.examples > li')].map(txt).filter(Boolean)
    })).filter((i) => i.idiom);

    const audioEl = (sel) => entry.querySelector(sel)?.getAttribute('data-src-mp3') || '';

    /* Many concrete nouns carry an OALD illustration; the thumbnail links to a
     * full-size copy. Abstract words simply have none. */
    const thumb = entry.querySelector('img.thumb');
    const image = thumb
      ? { thumb: thumb.src, full: thumb.closest('a')?.href || thumb.src }
      : null;

    return {
      id: `${word}#${pos || '-'}`,
      word,
      pos,
      cefr: cefrOf(webtop),
      url: location.href.split('?')[0],
      phonetics: {
        br: txt(entry.querySelector('.phons_br .phon')),
        am: txt(entry.querySelector('.phons_n_am .phon'))
      },
      audio: {
        br: audioEl('.sound.pron-uk'),
        am: audioEl('.sound.pron-us')
      },
      senses,
      extraExamples,
      idioms,
      image
    };
  }

  window.OALDParser = { parse };
})();
