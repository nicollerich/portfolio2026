// POST /api/organic-answer
// Cloudflare Pages Function that rewrites a base answer using Workers AI,
// enforcing the same guardrails the local Ollama dev server uses.
//
// Requires a Pages Function binding named "AI" (type: Workers AI)
// configured in Pages project Settings → Functions → Bindings.

import {
  hasForbiddenNamedEntity,
  hasOutOfScopeTerms,
  humanizeBaseAnswer
} from '../_lib/guardrails.js';

const MODEL = '@cf/meta/llama-3.1-8b-instruct';

const SYSTEM_PROMPT =
  'You rewrite answers to stay strictly faithful to the source. ' +
  'Never invent new facts, companies, titles, or metrics.';

function buildUserPrompt(question, baseAnswer) {
  return [
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
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(init.headers || {})
    }
  });
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
  if (!question || !baseAnswer) {
    return json(
      { ok: false, error: 'question and baseAnswer are required' },
      { status: 400 }
    );
  }

  if (!env.AI) {
    return json({ ok: false, answer: baseAnswer, error: 'AI binding missing' });
  }

  try {
    const result = await env.AI.run(MODEL, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(question, baseAnswer) }
      ],
      temperature: 0.25,
      top_p: 0.9,
      max_tokens: 120
    });

    const answer = (result?.response || '').trim();

    if (!answer) return json({ ok: true, answer: humanizeBaseAnswer(baseAnswer) });
    if (answer.length > 300) return json({ ok: true, answer: humanizeBaseAnswer(baseAnswer) });
    if (hasForbiddenNamedEntity(answer, baseAnswer)) {
      return json({ ok: true, answer: humanizeBaseAnswer(baseAnswer) });
    }
    if (hasOutOfScopeTerms(answer, baseAnswer)) {
      return json({ ok: true, answer: humanizeBaseAnswer(baseAnswer) });
    }

    return json({ ok: true, answer });
  } catch (error) {
    return json({ ok: false, answer: baseAnswer, error: String(error) });
  }
}

export async function onRequest({ request }) {
  if (request.method === 'POST') return onRequestPost({ request });
  return json({ ok: false, error: 'Method not allowed' }, { status: 405 });
}
