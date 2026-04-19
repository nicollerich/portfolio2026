// Shared guardrail helpers for the AI rewording endpoint.
// Ported from server.mjs so both the local Node dev server and the
// Cloudflare Pages Function enforce identical output constraints.

export function normalizeText(value) {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Short/opinion-style base answers (e.g. "Obviously.") have no real tokens
// to compare against. Skipping this strict guard in those cases lets the
// model expand naturally without getting rejected into "In short, Obviously."
export function hasOutOfScopeTerms(answer, baseAnswer) {
  const baseTokens = new Set(
    normalizeText(baseAnswer).split(' ').filter(Boolean)
  );
  const answerTokens = normalizeText(answer).split(' ').filter(Boolean);
  if (baseTokens.size < 3) return false;

  const allowedExtra = new Set([
    'nico', 'matson', 'she', 'her', 'hers',
    'organic', 'focused', 'focuses', 'across',
    'works', 'work', 'experience', 'experiences',
    'leader', 'leading', 'based', 'helps',
    'building', 'products', 'product', 'design'
  ]);

  return answerTokens.some((token) => {
    if (token.length < 5) return false;
    if (baseTokens.has(token)) return false;
    if (allowedExtra.has(token)) return false;
    return true;
  });
}

export function hasForbiddenNamedEntity(answer, baseAnswer) {
  const forbidden = ['google', 'meta', 'openai', 'microsoft', 'apple', 'amazon'];
  const answerText = normalizeText(answer);
  const baseText = normalizeText(baseAnswer);
  return forbidden.some(
    (name) => answerText.includes(name) && !baseText.includes(name)
  );
}

export function humanizeBaseAnswer(baseAnswer) {
  if (!baseAnswer) return baseAnswer;
  const raw = baseAnswer.trim();
  if (!raw) return raw;
  const sentence = raw.endsWith('.') ? raw.slice(0, -1) : raw;
  return `In short, ${sentence}.`;
}
