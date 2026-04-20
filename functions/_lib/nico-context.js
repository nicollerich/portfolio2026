// Shared helpers for loading Nico's knowledge base and formatting it for
// an LLM system prompt. The knowledge base lives in
// /search-question-index.json at the site root and is the single
// source of truth for anything the AI is allowed to say.

/**
 * Fetch the knowledge base JSON from the same origin the Function is
 * being served from. Using same-origin keeps us honest: whatever is
 * deployed alongside the Function is what Claude sees, so updates to
 * the index propagate without a code change.
 */
export async function fetchKnowledgeBase(request) {
  try {
    const indexUrl = new URL('/search-question-index.json', request.url);
    const res = await fetch(indexUrl.toString(), {
      headers: { 'Accept': 'application/json' },
      // Pages Functions can hit their own site freely; cache briefly at edge.
      cf: { cacheTtl: 300 }
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !Array.isArray(data.entries)) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Flatten the knowledge base into a compact, labelled block suitable
 * for dropping into a Claude system / user prompt. Grouping by
 * category keeps things readable and lets the model navigate the
 * context efficiently.
 */
export function formatKnowledgeAsContext(kb) {
  if (!kb || !Array.isArray(kb.entries)) return '';

  const byCategory = new Map();
  for (const entry of kb.entries) {
    const cat = (entry.category || 'general').toLowerCase();
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(entry);
  }

  const sections = [];
  for (const [category, entries] of byCategory.entries()) {
    const lines = entries.map((e) => {
      const q = (e.question || '').trim();
      const a = (e.answer || '').trim();
      if (!q || !a) return '';
      return `- Q: ${q}\n  A: ${a}`;
    }).filter(Boolean);
    if (!lines.length) continue;
    sections.push(`## ${category.toUpperCase()}\n${lines.join('\n')}`);
  }

  return sections.join('\n\n');
}

/**
 * Collect the first-person "allowed facts" into a short list of
 * plain strings, used for guardrail checks (e.g. verifying Claude
 * didn't invent a company). We just pull out answer text and join.
 */
export function collectAllAnswers(kb) {
  if (!kb || !Array.isArray(kb.entries)) return '';
  return kb.entries
    .map((e) => (e.answer || '').trim())
    .filter(Boolean)
    .join(' ');
}
