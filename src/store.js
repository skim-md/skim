// Store listings for Skim. Kept in one place so the popup, the review nudge,
// and any future "share" surface all point at the right store for the browser
// the reader is actually using.
import { isFirefox } from './browser-env.js';

export const STORE_ID = 'feeikgjlekgeepjljmnifkbnpcnflcmd';
export const CHROME_STORE_URL = `https://chromewebstore.google.com/detail/skim-markdown-viewer-read/${STORE_ID}`;
export const FIREFOX_STORE_URL = 'https://addons.mozilla.org/firefox/addon/skim-markdown-viewer-reader/';

export const STORE_URL = isFirefox() ? FIREFOX_STORE_URL : CHROME_STORE_URL;
export const STORE_REVIEW_URL = isFirefox()
  ? `${FIREFOX_STORE_URL}reviews/`
  : `${CHROME_STORE_URL}/reviews`;

export const ISSUES_URL = 'https://github.com/skim-md/skim/issues/new';
