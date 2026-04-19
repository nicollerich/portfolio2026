# portfolio2026

## Run with local LLM answers

This project can answer search questions using a local Ollama model and your `search-question-index.json`.

### 1) Start Ollama

Install and run Ollama, then pull a small model:

- `ollama pull llama3.2:1b`

### 2) Start the site server

- `npm start`

This runs at `http://localhost:3000` and exposes:

- `POST /api/organic-answer` (uses local Ollama)

### Notes

- Search first matches your local Q&A JSON.
- If Ollama is available, it rewrites the matched answer in a more organic tone.
- If Ollama is unavailable, it falls back to the base JSON answer.