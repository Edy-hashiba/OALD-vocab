const SEARCH = 'https://www.oxfordlearnersdictionaries.com/search/english/?q=';

document.getElementById('search').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('q').value.trim();
  if (!q) return;
  /* OALD's own search handles both exact hits and "did you mean" suggestions,
   * so there is nothing to reimplement here. */
  chrome.tabs.create({ url: SEARCH + encodeURIComponent(q) });
  window.close();
});

const openReview = (hash) => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/review.html') + hash });
  window.close();
};
document.getElementById('review').addEventListener('click', () => openReview('#review'));
document.getElementById('list').addEventListener('click', () => openReview(''));

(async () => {
  const s = await VocabDB.stats();
  const cell = (n, label, cls) =>
    `<div class="${cls || ''}"><b>${n}</b><span>${label}</span></div>`;
  document.getElementById('stats').innerHTML =
    cell(s.live, '学習中') +
    cell(s.due, '復習可能') +
    cell(s.attention, '2か月経過', s.attention ? 'warn' : '') +
    cell(s.archived, '卒業');
})();
