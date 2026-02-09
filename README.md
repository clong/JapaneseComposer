# Japanese Composer

A lightweight, runtime-dependency-free web-based Japanese/English journal composer with furigana toggle, kanji hover details, and a built-in vocabulary list.

## Requirements

- Node.js >= 18
- `sqlite3` CLI (optional, only needed for vocab persistence when running the dev server)

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

## Tests

```bash
npm test
```

The tests run the build script and verify the output artifacts.

## Dictionary lookup

The app uses the public Jisho API at `https://jisho.org/api/v1/search/words?keyword=` for kana readings and English meanings. If the API is unreachable, the composer still works, but kanji hover and furigana will show fallback text.

### Offline dictionary (local JMdict)

To avoid rate limits, you can build a local JMdict index for the dev server. This runs entirely on your machine and the `/api/lookup` route will use it first.

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

## Dev server-only features

- Translation, proofreading, and selected text Q&A require the dev server (`npm run dev`). Opening `dist/index.html` directly will not enable these API-backed features.

## Notes

- Vocabulary entries are stored in SQLite when running the dev server (`data/vocab.sqlite`, override with `VOCAB_DB_PATH`). Opening `dist/index.html` directly falls back to `localStorage` under the key `jc_vocab_list`.
- The dev server persistence uses the system `sqlite3` CLI; ensure it is available on your `PATH`.
- The UI language toggle switches labels between English and Japanese.
