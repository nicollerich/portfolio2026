// GET /api/llm-status
// Reports whether the Workers AI binding is available and which model
// the /api/organic-answer endpoint uses. Matches the response shape
// the local Ollama dev server returns, so search-assistant.js needs
// no frontend changes.

const MODEL = '@cf/meta/llama-3.1-8b-instruct';
const MODEL_DISPLAY = 'llama-3.1-8b';

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export async function onRequestGet({ env }) {
  const available = Boolean(env && env.AI);
  return json({
    ok: true,
    available,
    model: available ? MODEL_DISPLAY : null
  });
}
