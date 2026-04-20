// GET /api/claude-probe
// Diagnostic endpoint: makes a minimal, cheap call to Anthropic and returns
// the exact result (status code + response body or parsed text). Useful when
// /api/organic-answer falls back silently to Workers AI or to the static
// message and you need to see *why* Claude wasn't used.
//
// Safe to leave deployed: returns nothing sensitive, and the key itself is
// only read server-side.

const CLAUDE_MODEL = 'claude-opus-4-7';

function json(data, init = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(init.headers || {})
    }
  });
}

export async function onRequestGet({ env }) {
  if (!env || !env.ANTHROPIC_API_KEY) {
    return json({
      ok: false,
      stage: 'env',
      error: 'ANTHROPIC_API_KEY is not set on this environment (Production vs Preview?)'
    });
  }

  // Quick sanity check on the key shape — purely local, no network call.
  const keyLen = env.ANTHROPIC_API_KEY.length;
  const keyPrefix = env.ANTHROPIC_API_KEY.slice(0, 7);
  const keyLooksRight = env.ANTHROPIC_API_KEY.startsWith('sk-ant-');

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
        messages: [
          { role: 'user', content: 'Say "probe ok" and nothing else.' }
        ]
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
      text = parsed.content
        .filter((b) => b && b.type === 'text')
        .map((b) => b.text || '')
        .join('')
        .trim();
    }
  } catch {
    // anthropicBody wasn't JSON — leave as raw text below
  }

  return json({
    ok: anthropicStatus === 200 && !!text,
    keyShape: {
      detected: true,
      length: keyLen,
      prefix: keyPrefix,
      looksRight: keyLooksRight
    },
    model: CLAUDE_MODEL,
    anthropicStatus,
    anthropicError,
    text,
    rawBodyPreview: anthropicBody ? anthropicBody.slice(0, 800) : null
  });
}
