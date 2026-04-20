// GET /api/llm-status
// Reports which LLM path is currently active for /api/organic-answer.
// Priority:
//   1. Claude (if ANTHROPIC_API_KEY is configured)
//   2. Workers AI (if env.AI binding exists)
//   3. No AI (base-answer fallback)

const CLAUDE_MODEL_DISPLAY = 'Claude Opus 4.7';
const WORKERS_AI_DISPLAY = 'llama-3.1-8b';

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export async function onRequestGet({ env }) {
  const claudeAvailable = Boolean(env && env.ANTHROPIC_API_KEY);
  const workersAvailable = Boolean(env && env.AI);

  if (claudeAvailable) {
    return json({
      ok: true,
      available: true,
      model: CLAUDE_MODEL_DISPLAY,
      source: 'claude',
      fallback: workersAvailable ? WORKERS_AI_DISPLAY : null
    });
  }

  if (workersAvailable) {
    return json({
      ok: true,
      available: true,
      model: WORKERS_AI_DISPLAY,
      source: 'workers-ai',
      fallback: null
    });
  }

  return json({
    ok: true,
    available: false,
    model: null,
    source: null,
    fallback: null
  });
}
