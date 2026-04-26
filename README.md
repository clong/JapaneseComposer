# Japanese Composer

A lightweight, runtime-dependency-free web-based Japanese/English journal composer with furigana toggle, kanji hover details, and a built-in vocabulary list.

## Requirements

- Node.js >= 18
- `sqlite3` CLI (required for API-backed persistence/auth when running the dev server)

## Quick start

```bash
npm run build
```

Open `dist/index.html` in your browser.

### Dev server (optional)

```bash
npm run dev
```

Then visit the printed local URL.

### Authentication

Basic authentication is optional. Enable it via:

```bash
BASIC_AUTH_PASSWORD=your_password npm run dev
```

Optionally override the prompt text with `BASIC_AUTH_REALM`.

### Google OAuth + Account Sync

To enable Google sign-in and per-user server-side workspace sync, configure:

```bash
GOOGLE_OAUTH_CLIENT_ID=your_client_id \
GOOGLE_OAUTH_CLIENT_SECRET=your_client_secret \
GOOGLE_OAUTH_REDIRECT_URI=https://your-domain.example/api/auth/google/callback \
npm run dev
```

When enabled, the app syncs full workspace state (documents/posts, vocab, Q&A/proofread feedback, and corrections baseline) to the server under the signed-in user account.

Optional auth/session env vars:

- `REQUIRE_GOOGLE_AUTH=1` to block access to the composer until a Google session exists
- `ALLOWED_GOOGLE_EMAILS=user1@gmail.com,user2@gmail.com` to restrict sign-in to specific Google accounts
- `SESSION_COOKIE_NAME` (default: `jc_session`)
- `SESSION_MAX_AGE_MS` (default: 30 days)

When `REQUIRE_GOOGLE_AUTH=1` is set, the app shows a Google sign-in gate before the composer loads, and backend API access is restricted to authenticated sessions. If `ALLOWED_GOOGLE_EMAILS` is set, only those addresses can complete sign-in.

## Tests

```bash
npm test
```

The tests run the build script and verify the output artifacts.

## Dictionary lookup

Dictionary lookups are served by the local `/api/lookup` endpoint. If no local dictionary index is available (or no match is found), the composer still works, but kanji hover and furigana will show fallback text.

### Local dictionary (JMdict)

Build a local JMdict index for the dev server. This runs entirely on your machine and powers the `/api/lookup` route.

1. Download JMdict (EDRDG) and place it at `data/JMdict_e`:

```bash
mkdir -p data
curl -L -o data/JMdict_e.gz https://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz
gunzip -f data/JMdict_e.gz
```

2. Build the local index:

```bash
npm run dict:build
```

3. Start the dev server:

```bash
npm run dev
```

You can also override paths with:

```bash
JMDICT_PATH=/path/to/JMdict_e npm run dict:build
JMDICT_ENTRIES_PATH=/path/to/jmdict-entries.json JMDICT_INDEX_PATH=/path/to/jmdict-index.json npm run dev
```

## Translation

Selection translation uses the Google Cloud Translation API v2 via the local dev server proxy. Provide an API key when running the dev server:

```bash
GOOGLE_TRANSLATE_API_KEY=your_key_here npm run dev
```

If the key is missing, the translate action will show an error.

## Proofreading

The Proofread button uses the OpenAI Responses API via the local dev server proxy. Provide an API key when running the dev server:

```bash
OPENAI_API_KEY=your_key_here npm run dev
```

You can override the model with `OPENAI_MODEL` (defaults to `gpt-4.1`).

## Selected text Q&A

The "Ask" action (for selected text questions) uses the OpenAI Responses API via the local dev server proxy. Provide the same `OPENAI_API_KEY` (and optional `OPENAI_MODEL`) when running the dev server.

## Sharing With Google Users

When signed in, use the in-app "Share with Google User" panel to send the current entry to another signed-in user by email. The shared document includes:

- Composer text
- Corrections baseline for tracked edits
- Saved vocabulary
- Proofreading output
- Questions and answers

After a student submits a shared review, they can use the workflow panel's "Update submission" action to push a revised snapshot to the reviewer before feedback is returned. The update is blocked if the reviewer already has unsent edits in progress.

## Dev server-only features

- Translation, proofreading, and selected text Q&A require the dev server (`npm run dev`). Opening `dist/index.html` directly will not enable these API-backed features.

## Notes

- Vocabulary entries are stored in SQLite when running the dev server (`data/vocab.sqlite`, override with `VOCAB_DB_PATH`). Opening `dist/index.html` directly falls back to `localStorage` under the key `jc_vocab_list`.
- Signed-in workspace data is stored in SQLite (`data/workspace.sqlite`, override with `WORKSPACE_DB_PATH`).
- The dev server persistence uses the system `sqlite3` CLI; ensure it is available on your `PATH`.
- The UI language toggle switches labels between English and Japanese.
