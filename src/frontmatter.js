// Extract a leading YAML frontmatter block. Supports the subset agents and
// static-site tools actually emit: `key: value` scalars and `- item` lists.
// Anything fancier returns {fields: null} and the document is left alone.
export function extractFrontmatter(source) {
  const src = String(source);
  const m = src.match(/^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m || !m[1].trim()) return { fields: null, body: src };
  const fields = [];
  let currentList = null;
  for (const rawLine of m[1].split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, '  ').replace(/\r$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = line.match(/^\s+-\s+(.*)$/) || (currentList && line.match(/^-\s+(.*)$/));
    if (item && currentList) { currentList.push(stripQuotes(item[1])); continue; }
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!kv) return { fields: null, body: src };
    const [, key, value] = kv;
    if (value === '') { currentList = []; fields.push([key, currentList]); }
    else { currentList = null; fields.push([key, stripQuotes(value)]); }
  }
  if (!fields.length) return { fields: null, body: src };
  return { fields, body: src.slice(m[0].length) };
}

function stripQuotes(v) {
  const t = v.trim();
  return /^(['"]).*\1$/.test(t) ? t.slice(1, -1) : t;
}

// Build the frontmatter header card as plain DOM (textContent only — no
// innerHTML for values, since they're untrusted document content).
export function buildFrontmatterCard(fields) {
  const card = document.createElement('section');
  card.className = 'skim-frontmatter';
  for (const [key, value] of fields) {
    const row = document.createElement('div');
    row.className = 'skim-fm-row';
    const k = document.createElement('span');
    k.className = 'skim-fm-key';
    k.textContent = key;
    const v = document.createElement('span');
    v.className = 'skim-fm-value';
    v.textContent = Array.isArray(value) ? value.join(' · ') : value;
    row.append(k, v);
    card.append(row);
  }
  return card;
}
