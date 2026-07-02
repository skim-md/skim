// Enhance Chrome's file:// directory listings: surface markdown files.
// Runs on every file:// page, so the guard must be first and cheap.
function isDirectoryListing() {
  return location.protocol === 'file:'
    && location.pathname.endsWith('/')
    && !!document.querySelector('#listing, #parentDirLinkBox, table');
}

function run() {
  if (!isDirectoryListing()) return;
  const links = Array.from(document.querySelectorAll('a[href]'))
    .filter((a) => /\.(md|markdown|mdown|mkd|mkdn|mdx)$/i.test(a.getAttribute('href') || ''));
  if (!links.length) return;
  for (const a of links) a.classList.add('skim-md-link');
  const banner = document.createElement('div');
  banner.className = 'skim-folder-banner';
  banner.textContent = `📄 ${links.length} markdown file${links.length === 1 ? '' : 's'} here — click any to read with Skim`;
  document.body.prepend(banner);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
else run();
