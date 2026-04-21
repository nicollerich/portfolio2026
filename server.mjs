import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Serve files from this project folder, not from process.cwd() (which breaks if
   `node server.mjs` is started from another directory — then every image/js 404s). */
const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:1b';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm'
};

function normalizeText(value) {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasOutOfScopeTerms(answer, baseAnswer) {
  const baseTokens = new Set(normalizeText(baseAnswer).split(' ').filter(Boolean));
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

function hasForbiddenNamedEntity(answer, baseAnswer) {
  const forbidden = [
    'google',
    'meta',
    'openai',
    'microsoft',
    'apple',
    'amazon'
  ];
  const answerText = normalizeText(answer);
  const baseText = normalizeText(baseAnswer);
  return forbidden.some((name) => answerText.includes(name) && !baseText.includes(name));
}

function humanizeBaseAnswer(baseAnswer) {
  if (!baseAnswer) return baseAnswer;
  const raw = baseAnswer.trim();
  if (!raw) return raw;
  const sentence = raw.endsWith('.') ? raw.slice(0, -1) : raw;
  return `In short, ${sentence}.`;
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

function safePath(urlPath) {
  const clean = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  return join(ROOT, clean);
}

/** Browsers send spaces as %20; `URL.pathname` keeps them encoded, so we must decode or files with spaces 404. */
function decodeUrlPathname(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

async function askOllama(question, baseAnswer) {
  const prompt = [
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

  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: {
        temperature: 0.25,
        top_p: 0.9,
        num_predict: 90
      }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const answer = (data.response || '').trim();
  if (!answer) return humanizeBaseAnswer(baseAnswer);
  if (answer.length > 300) return humanizeBaseAnswer(baseAnswer);
  if (hasForbiddenNamedEntity(answer, baseAnswer)) return humanizeBaseAnswer(baseAnswer);
  if (hasOutOfScopeTerms(answer, baseAnswer)) return humanizeBaseAnswer(baseAnswer);
  return answer;
}

async function checkOllamaAvailable() {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  try {
    if (!req.url) {
      sendJson(res, 400, { ok: false, error: 'Missing URL' });
      return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname === '/api/organic-answer' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const question = (body.question || '').toString().trim();
      const baseAnswer = (body.baseAnswer || '').toString().trim();
      if (!question || !baseAnswer) {
        sendJson(res, 400, { ok: false, error: 'question and baseAnswer are required' });
        return;
      }

      try {
        const answer = await askOllama(question, baseAnswer);
        sendJson(res, 200, { ok: true, answer: answer || baseAnswer });
      } catch (error) {
        sendJson(res, 200, { ok: false, answer: baseAnswer, error: String(error) });
      }
      return;
    }

    if (url.pathname === '/api/llm-status' && req.method === 'GET') {
      const available = await checkOllamaAvailable();
      sendJson(res, 200, {
        ok: true,
        available,
        model: OLLAMA_MODEL
      });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: 'Method not allowed' });
      return;
    }

    let pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    pathname = decodeUrlPathname(pathname);
    const filePath = safePath(pathname);
    const exists = existsSync(filePath);
    const isFile = exists && statSync(filePath).isFile();
    if (!exists || !isFile) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = extname(filePath).toLowerCase();
    const type = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(filePath).pipe(res);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: String(error) });
  }
});

server.listen(PORT, () => {
  console.log(`Portfolio server running at http://localhost:${PORT}`);
  console.log(`Ollama model: ${OLLAMA_MODEL}`);
});
