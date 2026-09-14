const REVIEW_URL = chrome.runtime.getURL('src/review.html');

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'OPEN_REVIEW') {
    /* Reuse the review tab instead of stacking up duplicates. */
    chrome.tabs.query({ url: REVIEW_URL }, (tabs) => {
      if (tabs.length) chrome.tabs.update(tabs[0].id, { active: true });
      else chrome.tabs.create({ url: REVIEW_URL });
    });
    sendResponse({ ok: true });
  }
  return true;
});
