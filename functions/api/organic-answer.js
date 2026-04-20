// POST /api/organic-answer
// Cloudflare Pages Function that turns a user question into a natural,
// first-person reply. We try Claude first (when ANTHROPIC_API_KEY is
// configured) because it can synthesize across multiple documented
// facts; if Claude is unavailable or its answer fails guardrails we
// fall back to Workers AI (Llama 3.1), which only rewords the matched
// base answer; if Workers AI also fails we return a lightly
// humanized version of the base answer.
//
// Required env/bindings:
//   - env.ANTHROPIC_API_KEY  (Pages secret) — enables Claude path
//   - env.AI                 (Workers AI binding) — enables fallback

import {
  hasForbiddenNamedEntity,
  hasOutOfScopeTerms,
  humanizeBaseAnswer
} from '../_lib/guardrails.js';
import {
  fetchKnowledgeBase,
  formatKnowledgeAsContext,
  collectAllAnswers
} from '../_lib/nico-context.js';

// ────────────────────────────────────────────────────────────────
// Model identifiers — bumpable from one place.
// Anthropic aliases (non-dated) are stable; if Opus 4.7 isn't
// generally available under this slug, swap for the dated variant
// from https://docs.anthropic.com/en/docs/about-claude/models
// ────────────────────────────────────────────────────────────────
const CLAUDE_MODEL = 'claude-opus-4-7';
const CLAUDE_MODEL_DISPLAY = 'Claude Opus 4.7';
const WORKERS_AI_MODEL = '@cf/meta/llama-3.1-8b-instruct';

// Soft length cap for the first-person answer. Keeps the UI tight and
// discourages the model from drifting into invented territory.
const MAX_ANSWER_CHARS = 360;

const CLAUDE_SYSTEM_PROMPT = [
  "You are Nico Matson, a product design leader based in NYC.",
  "You're answering questions about yourself on your own portfolio site.",
  "",
  "VOICE:",
  "- Always write in the first person ('I', 'my', 'me').",
  "- Keep it natural and conversational — like you're chatting with someone in a coffee shop.",
  "- 1-3 sentences. Tight. No preamble, no sign-off.",
  "",
  "GROUNDING RULES (non-negotiable):",
  "- Every factual claim you make MUST be supported by the KNOWLEDGE BASE the user provides.",
  "- You MAY paraphrase, combine multiple documented facts, and add natural first-person color (e.g. 'I really enjoyed', 'what I care about') as long as the underlying facts are in the knowledge base.",
  "- You MUST NOT invent or imply: companies, job titles, dates, team sizes, metrics, clients, products, or outcomes that aren't documented.",
  "- If the question can't be answered from the knowledge base, say so in-voice — something like: 'I haven't written that up publicly yet — feel free to email me.' (her email is in the knowledge base under Contact).",
  "",
  "CLOSEST MATCH:",
  "- The user may provide a 'closest documented answer' as a hint. Treat it as a strong signal but you're free to rephrase, expand with other documented facts, or deprioritize it if the question is really about something else."
].join('\n');

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(init.headers || {})
    }
  });
}

function buildClaudeUserMessage(question, baseAnswer, contextBlob) {
  const parts = [
    'KNOWLEDGE BASE (your documented truth — stay inside this):',
    '',
    contextBlob || '(knowledge base unavailable — answer conservatively)',
    '',
    `QUESTION: ${question}`
  ];
  if (baseAnswer) {
    parts.push('', `CLOSEST DOCUMENTED ANSWER (hint, not a script): ${baseAnswer}`);
  }
  parts.push('', 'Reply in first person, 1-3 sentences, grounded only in the knowledge base.');
  return parts.join('\n');
}

async function tryClaude({ env, question, baseAnswer, contextBlob, allAnswersBlob }) {
  if (!env || !env.ANTHROPIC_API_KEY) return null;

  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 220,
    temperature: 0.4,
    system: CLAUDE_SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: buildClaudeUserMessage(question, baseAnswer, contextBlob) }
    ]
  };

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });
  } catch (err) {
    return { error: `network: ${String(err)}` };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { error: `claude ${res.status}: ${text.slice(0, 200)}` };
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    return { error: 'claude parse error' };
  }

  // Anthropic returns `content` as an array of blocks; we want the
  // concatenated text from the text-type blocks.
  const text = Array.isArray(payload?.content)
    ? payload.content.filter((b) => b?.type === 'text').map((b) => b.text || '').join('').trim()
    : '';

  if (!text) return { error: 'claude empty response' };
  if (text.length > MAX_ANSWER_CHARS) {
    return { error: 'claude answer too long' };
  }

  // Guardrail: verify Claude didn't slip in a forbidden named entity
  // (Google/Meta/etc.) against the full knowledge-base answers. The
  // full kb is a much richer reference than a single base answer.
  const groundingText = allAnswersBlob || baseAnswer || '';
  if (hasForbiddenNamedEntity(text, groundingText)) {
    return { error: 'claude hit forbidden named entity' };
  }

  return { answer: text };
}

async function tryWorkersAi({ env, question, baseAnswer }) {
  if (!env || !env.AI || !baseAnswer) return null;

  const systemPrompt =
    'You rewrite answers to stay strictly faithful to the source. ' +
    'Never invent new facts, companies, titles, or metrics.';

  const userPrompt = [
    'Rewrite the answer naturally in 1-2 short sentences.',
    'CRITICAL RULES:',
    '- Use only facts from the provided base answer.',
    '- Do not add or change companies, titles, dates, metrics, or achievements.',
    '- Keep names, role titles, and scope faithful to the base answer.',
    '- If unsure, keep very close to the base answer.',
    '',
    `Question: ${question}`,
    `Base answer: ${baseAnswer}`,
    '',
    'Return only the rewritten answer text.'
  ].join('\n');

  let result;
  try {
    result = await env.AI.run(WORKERS_AI_MODEL, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.25,
      top_p: 0.9,
      max_tokens: 120
    });
  } catch (err) {
    return { error: `workers-ai network: ${String(err)}` };
  }

  const answer = (result?.response || '').trim();
  if (!answer) return { error: 'workers-ai empty' };
  if (answer.length > MAX_ANSWER_CHARS) return { error: 'workers-ai too long' };
  if (hasForbiddenNamedEntity(answer, baseAnswer)) return { error: 'workers-ai forbidden entity' };
  if (hasOutOfScopeTerms(answer, baseAnswer)) return { error: 'workers-ai out of scope' };

  return { answer };
}

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const question = (body.question || '').toString().trim();
  const baseAnswer = (body.baseAnswer || '').toString().trim();
  if (!question) {
    return json({ ok: false, error: 'question is required' }, { status: 400 });
  }

  // Pull the knowledge base once for Claude grounding + guardrail reference.
  // baseAnswer is still accepted (frontend sends it) but we no longer require it.
  const kb = await fetchKnowledgeBase(request);
  const contextBlob = formatKnowledgeAsContext(kb);
  const allAnswersBlob = collectAllAnswers(kb);

  // ─── 1. Claude (preferred) ──────────────────────────────────
  const claude = await tryClaude({ env, question, baseAnswer, contextBlob, allAnswersBlob });
  if (claude && claude.answer) {
    return json({ ok: true, answer: claude.answer, source: 'claude', model: CLAUDE_MODEL_DISPLAY });
  }
  const claudeError = claude && claude.error ? claude.error : null;

  // ─── 2. Workers AI (fallback) ───────────────────────────────
  const workers = await tryWorkersAi({ env, question, baseAnswer });
  if (workers && workers.answer) {
    return json({ ok: true, answer: workers.answer, source: 'workers-ai', model: 'llama-3.1-8b', claudeError });
  }

  // ─── 3. Humanized base answer (ultimate fallback) ──────────
  if (baseAnswer) {
    return json({ ok: true, answer: humanizeBaseAnswer(baseAnswer), source: 'base', claudeError });
  }

  return json({
    ok: false,
    answer: "I haven't written that up publicly yet — feel free to email me at Nicolle.matson@gmail.com.",
    source: 'static',
    claudeError
  });
}

export async function onRequest({ request, env }) {
  if (request.method === 'POST') return onRequestPost({ request, env });
  return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
}
