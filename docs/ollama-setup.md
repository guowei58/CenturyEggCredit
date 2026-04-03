# Local Ollama in CenturyEggCredit

OREO can route **AI Chat**, **Covenants**, **AI Credit Memo**, **Credit Deck**, **Business Overview** (10-K summaries), and **presentations discovery** through a **local Ollama** server instead of (or alongside) Claude and OpenAI.

## Environment variables

Add to `.env.local` (optional — defaults work for a standard local install):

| Variable | Default | Purpose |
|----------|---------|---------|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama HTTP API base |
| `OLLAMA_MODEL` | `llama3.1:8b` | Default model tag for chat and most features |
| `AI_DEFAULT_PROVIDER` | — | Set to `ollama` to default server-side provider when the client omits one |

Optional per-feature model overrides (all fall back to `OLLAMA_MODEL`):

- `OLLAMA_COMMITTEE_MODEL` — AI Chat
- `OLLAMA_COVENANT_MODEL` — Covenants synthesis
- `OLLAMA_CREDIT_MEMO_MODEL` — Credit memo & credit deck generation
- `OLLAMA_OVERVIEW_MODEL` — Business overview / segment summaries
- `OLLAMA_PRESENTATIONS_MODEL` — Mgmt presentations discovery

Optional tuning:

- `OLLAMA_TEMPERATURE` — e.g. `0.7` (passed into Ollama `options`)

Cloud API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) are unchanged; Ollama does not use them.

## Install and run Ollama

1. Install [Ollama](https://ollama.com/) for your OS.
2. Start the server (often runs automatically after install; otherwise):

   ```bash
   ollama serve
   ```

3. Pull the model (must match `OLLAMA_MODEL` or your override):

   ```bash
   ollama pull llama3.1:8b
   ```

4. Smoke-test the model:

   ```bash
   ollama run llama3.1:8b
   ```

## Using Ollama in the app

1. Restart the Next.js dev server after editing `.env.local`.
2. In **AI Chat**, choose **Ollama** (third toggle). Status line shows **connected**, **not connected**, or **pull model** hints from `/api/committee-chat`.
3. **Covenants** and **AI Credit Memo** use the same saved provider preference (`oreo-ai-provider` in `localStorage`) when you pick **Ollama** there.
4. **Text only** in AI Chat for Ollama: PDF and image attachments require **Claude** or **ChatGPT**; the API returns a clear error if you attach binaries with Ollama selected.

## Testing checklist

- [ ] `ollama serve` running; `curl -s http://localhost:11434/api/tags` returns JSON.
- [ ] `ollama pull <OLLAMA_MODEL>` completed; model appears in `/api/tags`.
- [ ] Open AI Chat → **Ollama** → status shows connected; send a short message; assistant replies.
- [ ] Optional: Covenants **Regenerate** with **Ollama** selected (requires saved covenant text).
- [ ] Optional: Generate a small credit memo with **Ollama / Local Llama** (large prompts may be slow on small models).

## Common errors

| Symptom | What to do |
|---------|------------|
| “Cannot connect to Ollama” / disconnected | Start `ollama serve`; confirm `OLLAMA_BASE_URL` matches where Ollama listens. |
| “Model missing” / 404 from Ollama | Run `ollama pull <model>` for the exact name in `OLLAMA_MODEL`. |
| Timeout / very slow | Shorter prompts, smaller context, or a faster machine; local 8B models are slower than cloud APIs on big memos. |
| “text-only” error in chat | Switch to Claude (PDF) or ChatGPT (images) or paste text instead of attaching PDFs/images. |

Server logs: in development, failed Ollama calls log a short `[ollama]` prefix with HTTP status and a truncated body for debugging.
