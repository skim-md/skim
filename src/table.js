// Table enhancement: density-aware wrapping, breakout sizing, sorting,
// sticky header, and copy-as-TSV. Pure helpers are exported for unit tests;
// the DOM pass `enhanceTables` is called from main.js after render.
import { copyText } from './ui.js';

// Parse a cell string to a number, stripping whitespace, currency symbols,
// a trailing percent sign, and thousands separators. Returns null when the
// value is not a clean number.
export function parseNumeric(text) {
  if (text == null) return null;
  const cleaned = String(text)
    .trim()
    .replace(/[\s ]/g, '')
    .replace(/[$€£¥₪]/g, '')
    .replace(/%$/, '')
    .replace(/,/g, '');
  if (cleaned === '') return null;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Classify a column from its non-empty values. Numbers win over dates so
// bare years ("2024") read as numbers, not dates.
export function detectColumnType(values) {
  const nonEmpty = values.map((v) => String(v ?? '').trim()).filter((v) => v !== '');
  if (nonEmpty.length === 0) return 'text';
  if (nonEmpty.every((v) => parseNumeric(v) !== null)) return 'number';
  if (nonEmpty.every((v) => !Number.isNaN(Date.parse(v)))) return 'date';
  return 'text';
}

// Comparator for two cell strings given a column type. Empty values sort last
// regardless of direction (callers apply the asc/desc sign to the result).
export function compareValues(a, b, type) {
  if (type === 'number') {
    return compareNullable(parseNumeric(a), parseNumeric(b));
  }
  if (type === 'date') {
    const da = Date.parse(a); const db = Date.parse(b);
    return compareNullable(Number.isNaN(da) ? null : da, Number.isNaN(db) ? null : db);
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function compareNullable(na, nb) {
  if (na === null && nb === null) return 0;
  if (na === null) return 1;
  if (nb === null) return -1;
  return na - nb;
}

// Return a new array of the given rows sorted by one column. Stable: ties keep
// their original relative order. Reads each row's cell via `.cells[colIndex]`.
export function sortRows(rows, colIndex, type, direction) {
  const sign = direction === 'desc' ? -1 : 1;
  return rows
    .map((row, i) => ({ row, i, key: cellText(row, colIndex) }))
    .sort((x, y) => {
      const c = compareValues(x.key, y.key, type);
      return c !== 0 ? c * sign : x.i - y.i;
    })
    .map((d) => d.row);
}

function cellText(row, colIndex) {
  const cell = row.cells ? row.cells[colIndex] : null;
  return cell ? cell.textContent.trim() : '';
}

// Serialize a table to TSV (header + body). Tabs/newlines inside a cell are
// collapsed to a space so the row/column structure survives a paste.
export function serializeTable(table) {
  return Array.from(table.rows)
    .map((row) => Array.from(row.cells)
      .map((cell) => cell.textContent.replace(/[\t\r\n]+/g, ' ').trim())
      .join('\t'))
    .join('\n');
}

// Decide how wide a table may grow when it overflows its text column. Growth
// is symmetric around the column center, bounded by `leftBound`/`rightBound`
// (the TOC edge and the viewport margin), and never exceeds the table's
// natural (unwrapped) width. Returns null when the table already fits.
export function computeBreakout({ naturalWidth, columnLeft, columnRight, leftBound, rightBound }) {
  const columnWidth = columnRight - columnLeft;
  if (naturalWidth <= columnWidth + 1) return null;
  const center = (columnLeft + columnRight) / 2;
  const halfWidth = Math.min(center - leftBound, rightBound - center);
  const maxWidth = Math.max(columnWidth, halfWidth * 2);
  const width = Math.min(naturalWidth, maxWidth);
  const offset = (columnWidth - width) / 2;
  return { width, offset };
}

// Enhance every table in `article`: wrap, align numeric columns, wire sorting,
// add a copy button, and size breakout. Safe to call before layout exists
// (breakout simply does nothing until measurements are available).
//
// Auto-reload calls this again on the same `article` node each time the file
// changes on disk (Task 8), which would otherwise stack a new `window`
// resize listener per pass. The listener is tied to an AbortController whose
// abort function is exposed as `article.skimTableTeardown` (mirroring
// `toc.skimTeardown` in ui.js); the caller (main.js) tears down the previous
// pass before invoking this again.
export function enhanceTables(article) {
  const tables = Array.from(article.querySelectorAll('table'));
  tables.forEach(enhanceTable);
  if (!tables.length) return;

  const controller = new AbortController();
  article.skimTableTeardown = () => controller.abort();

  let ticking = false;
  window.addEventListener('resize', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      tables.forEach(updateBreakout);
    });
  }, { passive: true, signal: controller.signal });
}

// Re-measure every table's breakout against the CURRENT layout. Needed after
// anything that changes the column geometry post-enhancement — in particular
// mounting the TOC sidebar, which happens after populateArticle has already
// sized breakouts for a TOC-less (wider) column.
export function refreshBreakouts(article) {
  article.querySelectorAll('table').forEach(updateBreakout);
}

function enhanceTable(table) {
  const wrap = document.createElement('div');
  wrap.className = 'skim-table-wrap';
  table.parentNode.insertBefore(wrap, table);
  wrap.appendChild(table);

  const types = detectColumnTypes(table);
  applyNumericAlignment(table, types);

  const merged = table.querySelector('[colspan], [rowspan]');
  if (table.tHead && table.tBodies[0] && !merged) {
    attachSorting(table, types);
  }

  addCopyButton(wrap, table);
  updateBreakout(table);
}

// Per-column type from the first tbody's cells.
function detectColumnTypes(table) {
  const body = table.tBodies[0];
  if (!body) return [];
  const rows = Array.from(body.rows);
  const colCount = rows.reduce((m, r) => Math.max(m, r.cells.length), 0);
  const types = [];
  for (let c = 0; c < colCount; c++) {
    types.push(detectColumnType(rows.map((r) => (r.cells[c] ? r.cells[c].textContent : ''))));
  }
  return types;
}

function applyNumericAlignment(table, types) {
  const headRow = table.tHead && table.tHead.rows[table.tHead.rows.length - 1];
  const tag = (row) => {
    if (!row) return;
    types.forEach((type, c) => {
      if (type === 'number' && row.cells[c]) row.cells[c].classList.add('skim-col-num');
    });
  };
  tag(headRow);
  const body = table.tBodies[0];
  if (body) Array.from(body.rows).forEach(tag);
}

function attachSorting(table, types) {
  const thead = table.tHead;
  const headRow = thead.rows[thead.rows.length - 1];
  const body = table.tBodies[0];
  if (!headRow || !body) return;
  const originalRows = Array.from(body.rows);

  let activeCol = -1;
  let direction = 'none';

  Array.from(headRow.cells).forEach((th, colIndex) => {
    th.classList.add('skim-sortable');
    th.tabIndex = 0;
    th.setAttribute('role', 'button');
    const ind = document.createElement('span');
    ind.className = 'skim-sort-ind';
    ind.setAttribute('aria-hidden', 'true');
    th.appendChild(ind);

    const activate = () => {
      if (activeCol !== colIndex) {
        if (activeCol >= 0) {
          headRow.cells[activeCol].removeAttribute('aria-sort');
          headRow.cells[activeCol].classList.remove('skim-sorted', 'skim-sorted-desc');
        }
        activeCol = colIndex;
        direction = 'asc';
      } else {
        direction = direction === 'asc' ? 'desc' : direction === 'desc' ? 'none' : 'asc';
      }

      let ordered;
      if (direction === 'none') {
        ordered = originalRows;
        activeCol = -1;
        th.removeAttribute('aria-sort');
        th.classList.remove('skim-sorted', 'skim-sorted-desc');
      } else {
        ordered = sortRows(originalRows, colIndex, types[colIndex] || 'text', direction);
        th.setAttribute('aria-sort', direction === 'asc' ? 'ascending' : 'descending');
        th.classList.add('skim-sorted');
        th.classList.toggle('skim-sorted-desc', direction === 'desc');
      }
      ordered.forEach((row) => body.appendChild(row));
      updateBreakout(table);
    };

    th.addEventListener('click', activate);
    th.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    });
  });
}

function addCopyButton(wrap, table) {
  const btn = document.createElement('button');
  btn.className = 'skim-copy-btn skim-table-copy';
  btn.type = 'button';
  btn.textContent = '⧉ Copy';
  btn.addEventListener('click', () => copyText(serializeTable(table), btn, '✓ Copied'));
  wrap.appendChild(btn);
}

// Measure the table against the available width and apply (or clear) breakout.
// No-ops safely when there is no layout (jsdom) or no `.skim-main`.
export function updateBreakout(table) {
  const wrap = table.closest('.skim-table-wrap');
  if (!wrap) return;
  wrap.classList.remove('is-wide', 'is-scroll');
  wrap.style.removeProperty('--skim-table-width');
  wrap.style.removeProperty('--skim-table-offset');

  const main = document.querySelector('.skim-main');
  if (!main || typeof window === 'undefined') return;
  const cs = getComputedStyle(main);
  const rect = main.getBoundingClientRect();
  const columnLeft = rect.left + (parseFloat(cs.paddingLeft) || 0);
  const columnRight = rect.right - (parseFloat(cs.paddingRight) || 0);
  if (columnRight <= columnLeft) return; // no layout yet

  const naturalWidth = measureWidth(table, 'max-content');
  const minWidth = measureWidth(table, 'min-content');

  const PAGE_MARGIN = 16;
  let leftBound = PAGE_MARGIN;
  const toc = document.querySelector('.skim-toc');
  if (toc && toc.offsetParent !== null) leftBound = toc.getBoundingClientRect().right + 16;
  const rightBound = window.innerWidth - PAGE_MARGIN;

  const result = computeBreakout({ naturalWidth, columnLeft, columnRight, leftBound, rightBound });
  if (!result) return;

  wrap.classList.add('is-wide');
  wrap.style.setProperty('--skim-table-width', `${Math.round(result.width)}px`);
  wrap.style.setProperty('--skim-table-offset', `${Math.round(result.offset)}px`);
  if (minWidth > result.width + 1) wrap.classList.add('is-scroll');
}

// Read a table's intrinsic width at a given `width` keyword, then restore.
function measureWidth(table, keyword) {
  const prev = table.style.width;
  table.style.width = keyword;
  const w = table.getBoundingClientRect().width;
  table.style.width = prev;
  return w;
}
