// GET /api/claude-probe
// GET /api/claude-probe?q=tell+me+a+joke&mode=full
//
// Diagnostic endpoint. Two modes:
//   (default) Makes a minimal "probe" call to Anthropic to verify key/model.
//   mode=full — Simulates the same request /api/organic-answer makes so we
//               can see exactly where things fail in production.
//
// Safe to leave deployed: returns nothing sensitive.

import {
  hasForbiddenNamedEntity,
  hasOutOfScopeTerms
} from '../_lib/guardrails.js';
import {
  fetchKnowledgeBase,
  formatKnowledgeAsContext,
  collectAllAnswers
} from '../_lib/nico-context.js';

const CLAUDE_MODEL = 'claude-opus-4-7';
const MAX_ANSWER_CHARS = 360;

const CLAUDE_SYSTEM_PROMPT = [
  "You are Nico Matson (Nicolle Matson), a product design leader based in NYC.",
  "You're answering questions about yourself on your own portfolio site — imagine a recruiter, fellow designer, or curious friend dropping in.",
  "",
  "FACTS ABOUT ME (never contradict, joke away, or get clever about):",
  "- I am a woman. My pronouns are she/her/hers.",
  "- \"Nico\" is a nickname for Nicolle — it is not a statement about gender being ambiguous or \"both.\"",
  "- Never answer gender or pronoun questions with non-binary framing, \"both a boy and a girl,\" or similar unless those exact words appear in the knowledge base (they do not).",
  "",
  "VOICE:",
  "- Always write in the first person ('I', 'my', 'me').",
  "- Natural, warm, a little playful. Like you're chatting at a coffee shop, not reading off a résumé.",
  "- 1-3 sentences. Tight. No preamble, no sign-off, no emoji.",
  "",
  "WHAT YOU CAN DO:",
  "- Answer bio/career/work questions using the KNOWLEDGE BASE below.",
  "- Share opinions, reflections, or first-person color on topics you genuinely know (design philosophy, leadership, AI in products, specific tools or methods) as long as the underlying facts are grounded in the knowledge base.",
  "- Be playful when asked: tell a short design/tech/work-life joke, make a dry quip, share a favorite opinion. Personality is welcome — this is your site.",
  "- For questions with a close documented answer, let that be your starting point and expand naturally.",
  "",
  "HARD RULES (do not cross):",
  "- Never invent or imply: companies I worked at, job titles, dates, team sizes, metrics, clients, products, or outcomes that aren't in the knowledge base.",
  "- Never claim to have worked at a company not listed in the knowledge base.",
  "- Never fabricate specific numbers (salary, team size, user counts, revenue).",
  "- For purely off-topic asks you genuinely can't speak to (e.g. 'what's your favorite movie?' if not documented), decline in-voice and warmly point them to email: Nicolle.matson@gmail.com. Keep it light, not robotic.",
  "",
  "CLOSEST MATCH:",
  "- The user may provide a 'closest documented answer' as a hint. Use it as a strong starting signal, but you can rephrase, combine with other documented facts, or ignore it if the question is really about something else.",
  "- If no closest match is provided, the question might be personality/opinion/playful — still answer in-voice, grounded where facts are involved."
].join('\n');

function json(data, init = {}) {
  return new Response(JSON.stringify(data, null, 2), {
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

async function doMinimalProbe(env) {
  let anthropicStatus = null;
  let anthropicBody = null;
  let anthropicError = null;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 32,
        messages: [{ role: 'user', content: 'Say "probe ok" and nothing else.' }]
      })
    });
    anthropicStatus = res.status;
    anthropicBody = await res.text();
  } catch (err) {
    anthropicError = String(err);
  }

  let parsed = null;
  let text = null;
  try {
    parsed = anthropicBody ? JSON.parse(anthropicBody) : null;
    if (parsed && Array.isArray(parsed.content)) {
      text = parsed.content.filter((b) => b?.type === 'text').map((b) => b.text || '').join('').trim();
    }
  } catch { /* non-JSON body */ }

  return {
    mode: 'minimal',
    ok: anthropicStatus === 200 && !!text,
    model: CLAUDE_MODEL,
    anthropicStatus,
    anthropicError,
    text,
    rawBodyPreview: anthropicBody ? anthropicBody.slice(0, 800) : null
  };
}

async function doFullSimulation({ env, request, question }) {
  const steps = [];

  // Step 1: load knowledge base
  const kb = await fetchKnowledgeBase(request);
  steps.push({
    step: 'fetchKnowledgeBase',
    ok: !!kb,
    entryCount: kb?.entries?.length || 0
  });

  const contextBlob = formatKnowledgeAsContext(kb);
  const allAnswersBlob = collectAllAnswers(kb);
  steps.push({
    step: 'formatContext',
    contextChars: contextBlob.length,
    allAnswersChars: allAnswersBlob.length
  });

  // Step 2: build the exact same request /api/organic-answer sends
  const userMessage = buildClaudeUserMessage(question, '', contextBlob);
  const requestBody = {
    model: CLAUDE_MODEL,
    max_tokens: 220,
    system: CLAUDE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }]
  };
  steps.push({
    step: 'buildRequestBody',
    systemChars: CLAUDE_SYSTEM_PROMPT.length,
    userMessageChars: userMessage.length,
    totalBodyChars: JSON.stringify(requestBody).length
  });

  // Step 3: call Anthropic
  let anthropicStatus = null;
  let anthropicBody = null;
  let anthropicError = null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(requestBody)
    });
    anthropicStatus = res.status;
    anthropicBody = await res.text();
  } catch (err) {
    anthropicError = String(err);
  }
  steps.push({
    step: 'anthropicCall',
    ok: anthropicStatus === 200,
    status: anthropicStatus,
    error: anthropicError,
    rawBodyPreview: anthropicBody ? anthropicBody.slice(0, 600) : null
  });

  // Step 4: parse response
  let text = null;
  try {
    const parsed = anthropicBody ? JSON.parse(anthropicBody) : null;
    if (parsed && Array.isArray(parsed.content)) {
      text = parsed.content.filter((b) => b?.type === 'text').map((b) => b.text || '').join('').trim();
    }
  } catch { /* non-JSON */ }
  steps.push({
    step: 'parseResponse',
    ok: !!text,
    textLength: text?.length || 0,
    text
  });

  if (!text) {
    return { mode: 'full', question, verdict: 'no-text-from-claude', steps };
  }

  // Step 5: run guardrails
  const tooLong = text.length > MAX_ANSWER_CHARS;
  const forbidden = hasForbiddenNamedEntity(text, allAnswersBlob);
  const outOfScope = hasOutOfScopeTerms(text, allAnswersBlob);
  steps.push({
    step: 'guardrails',
    tooLong,
    hasForbiddenNamedEntity: forbidden,
    hasOutOfScopeTerms_infoOnly: outOfScope,
    answerCharsMax: MAX_ANSWER_CHARS
  });

  let verdict = 'would-pass';
  if (tooLong) verdict = 'rejected-too-long';
  else if (forbidden) verdict = 'rejected-forbidden-named-entity';

  return { mode: 'full', question, verdict, text, steps };
}

export async function onRequestGet({ env, request }) {
  if (!env || !env.ANTHROPIC_API_KEY) {
    return json({
      ok: false,
      stage: 'env',
      error: 'ANTHROPIC_API_KEY is not set on this environment (Production vs Preview?)'
    });
  }

  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') || 'minimal';
  const question = (url.searchParams.get('q') || 'tell me a joke').trim();

  const keyShape = {
    detected: true,
    length: env.ANTHROPIC_API_KEY.length,
    prefix: env.ANTHROPIC_API_KEY.slice(0, 7),
    looksRight: env.ANTHROPIC_API_KEY.startsWith('sk-ant-')
  };

  if (mode === 'full') {
    const result = await doFullSimulation({ env, request, question });
    return json({ ok: result.verdict === 'would-pass', keyShape, ...result });
  }

  const result = await doMinimalProbe(env);
  return json({ ok: result.ok, keyShape, ...result });
}
