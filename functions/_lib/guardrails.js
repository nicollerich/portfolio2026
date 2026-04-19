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

// A capable instruction model (Llama-3.1-8B) will almost always introduce
// paraphrased vocabulary, so a strict "any unknown long token → reject"
// check rejects nearly every valid rewording. Instead, we only reject when
// the answer is *predominantly* drifting off the source: more than ~35% of
// its long tokens are neither in the base answer nor a small allowlist.
// This still catches hallucinations (whole new sentences, invented facts)
// while letting natural rewordings through.
export function hasOutOfScopeTerms(answer, baseAnswer) {
  const baseTokens = new Set(
    normalizeText(baseAnswer).split(' ').filter(Boolean)
  );
  const answerTokens = normalizeText(answer).split(' ').filter(Boolean);
  if (baseTokens.size < 3) return false;

  const allowedExtra = new Set([
    'nico', 'matson', 'she', 'her', 'hers', 'herself',
    'organic', 'focused', 'focuses', 'across',
    'works', 'work', 'working', 'experience', 'experiences',
    'leader', 'leading', 'led', 'based', 'helps', 'helped',
    'building', 'built', 'products', 'product', 'design', 'designs',
    'designed', 'designer', 'designing', 'tools', 'users',
    'role', 'roles', 'team', 'teams', 'while', 'during',
    'through', 'where', 'which', 'that', 'there', 'these', 'those',
    'about', 'notably', 'primarily', 'mainly', 'mostly',
    'also', 'including', 'such', 'particularly'
  ]);

  const longTokens = answerTokens.filter((t) => t.length >= 5);
  if (longTokens.length === 0) return false;

  const outOfScope = longTokens.filter((token) => {
    if (baseTokens.has(token)) return false;
    if (allowedExtra.has(token)) return false;
    // Allow simple morphological variants already in base (design/designed,
    // collaborate/collaboration, etc.) so paraphrases aren't penalized.
    for (const baseToken of baseTokens) {
      if (baseToken.length < 4) continue;
      if (token.startsWith(baseToken) || baseToken.startsWith(token)) {
        return false;
      }
    }
    return true;
  });

  return outOfScope.length / longTokens.length > 0.35;
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
