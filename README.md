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

## Text appearance

The header's **A− / percentage / A+** controls change text size across Compose, Vocabulary, Reading, and dialogs, from 80% to 160%. Click the percentage to reset to 100%. The setting is saved in this browser and shared between its open app tabs. English and Japanese text use the same sans-serif font stack throughout the app: Manrope and Noto Sans JP, with system fallbacks.

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

## Adaptive Voice Speaking Tutor

The Tutor tab uses `gpt-live-1` for speech and a server-owned lesson director for objectives, assessment, repair, mastery, and spaced review. Provide an `OPENAI_API_KEY` with GPT-Live access when running the dev server:

```bash
set -a
source data/local.env
set +a
OPENAI_TUTOR_VOICE_MODEL=gpt-live-1 npm run dev
```

Optional tutor env vars:

- `OPENAI_TUTOR_VOICE_MODEL` (default: `gpt-live-1`; takes precedence over `OPENAI_REALTIME_MODEL`)
- `OPENAI_REALTIME_MODEL` (backward-compatible override; set `gpt-realtime-2` to use the previous transport)
- `OPENAI_REALTIME_VOICE` (default: `marin`)
- `OPENAI_TUTOR_REASONING_MODEL` (default: `gpt-5.6`)
- `OPENAI_TUTOR_REVIEW_MODEL` (legacy v1 review fallback)
- `TUTOR_AUDIO_MAX_BYTES` (default: 60 MB)
- `TUTOR_AUDIO_DIR` (default: `data/tutor-audio-v2`)
- `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` (optional Japanese pronunciation provider)
- `PORT` (default: `5173`)

The browser sends its WebRTC SDP offer to `/api/tutor/v2/sessions/:id/connect`. The server creates a GPT-Live session through `POST /v1/live/sessions`, retains the returned session ID, and attaches to `/v1/live/sessions/:id/attach`. Client delegation invokes the existing assessment model and lesson director. No OpenAI credential is returned to the browser. Existing transcripts, profiles, and recordings remain readable.

If your launch command sets `OPENAI_REALTIME_MODEL`, remove it or explicitly add `OPENAI_TUTOR_VOICE_MODEL=gpt-live-1` to select the new transport. Restart the server and start a new speaking session after changing models.

GPT-Live generates captions automatically; it does not expose the old transcription-language override. Japanese remains the practice language, with English explanations when requested. The pace slider now requests very slow, slow, natural, or brisk delivery through instructions rather than applying an exact audio speed multiplier. Voice selection still takes effect at session startup.

Live captions preserve original timed fragments and allow both speakers to overlap. Caption groups are approximate display segments, not confirmed completed responses. The speaking indicator follows playback audio levels. The old complete-response and interruption metrics are unavailable for Live sessions. Session duration usage is cumulative and is finalized only on `session.closed`.

Live audio is captured from the server sideband as bounded PCM and saved as WAV clips when a session ends. Input audio alignment is approximate because reflected input has no timestamps; these clips are for replay and are not sent to the specialist pronunciation scorer. Recordings cannot include audio from before sideband attachment. Ending a session waits for final usage before disconnecting, with a timeout recorded as incomplete finalization.

After loading the environment, `node scripts/tutor-live-smoke.js` runs an opt-in, billable Live API check. It verifies a Japanese greeting, non-silent PCM audio, captions, and final usage without opening the microphone. The ordinary `npm test` suite uses mocks and temporary databases, with no OpenAI requests.

Tutor v2 includes:

- JF/CEFR dimension profiles, with JLPT retained only as a content ceiling
- daily missions, prerequisite-linked A1-B2 skills, diagnostics, and monthly benchmarks
- guided, scenario, pronunciation, and free-conversation modes
- deterministic lesson phases and mandatory repair for high-confidence meaningful errors
- live Japanese/English transcription, server-side conversation logs, and structured post-turn evidence
- 30-day raw-audio retention, a 60 MB unpinned-audio budget, and a 10-minute per-session audio budget
- complete Tutor data deletion through `DELETE /api/tutor/v2/data`
- measurable release-gate reporting through `GET /api/tutor/v2/quality`

Audio is stored in files under `TUTOR_AUDIO_DIR`; SQLite stores metadata, assessments, mastery evidence, review schedules, benchmark results, and quality traces. Legacy v1 sessions remain available as history and are not promoted into mastery evidence.

External pronunciation processing is disabled until the learner explicitly opts in. The Azure adapter records supported Japanese accuracy and fluency signals only. It deliberately reports no Japanese pitch/prosody score. Browser WebM recordings remain saved when the provider cannot score their encoding.

The speaking framework follows the [JF Standard](https://www.jfstandard.jpf.go.jp/summaryen/ja/render.do). The Live transport follows OpenAI's [GPT-Live migration](https://developers.openai.com/api/docs/guides/live-migration), [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live), and [server-side control](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live) guidance.

## Sharing With Google Users

When signed in, use the in-app "Share with Google User" panel to send the current entry to another signed-in user by email. The shared document includes:

- Composer text
- Corrections baseline for tracked edits
- Saved vocabulary
- Proofreading output
- Questions and answers

After a student submits a shared review, they can use the workflow panel's "Update submission" action to push a revised snapshot to the reviewer before feedback is returned. The update is blocked if the reviewer already has unsent edits in progress.

## Reading practice

The **Reading** tab lists the latest NHK Easy stories available through [NHK Easier](https://nhkeasier.com/). Each article links to the mirror and the original NHK page. Article discovery is cached for ten minutes; a source outage shows the last fetched list when available.

Click a sentence to expand its translation editor. Several editors can stay open. Use **Grade sentence** for one answer or **Grade filled sentences** for all nonblank answers. Feedback accepts meaning-preserving paraphrases and minor mistakes, with optional wording suggestions. Editing an answer clears its previous grade.

Switch to **English → Japanese** to practice in reverse. English prompts are generated once per session and saved. The original Japanese sentence appears after grading. Each direction keeps separate answers and feedback. Select a Japanese or English word in an article, prompt, or editor to open the dictionary. Japanese selections show readings and English definitions; English selections show up to five Japanese equivalents with readings and meanings. English lookup searches the local JMdict definitions and uses the existing online fallback when needed. Furigana annotations are excluded from lookups. **Copy word** copies a Japanese equivalent for pasting into your answer; **Copy to clipboard** copies all displayed words, readings, and definitions.

Reading uses the same `OPENAI_API_KEY` and optional `OPENAI_MODEL` as proofreading (default `gpt-4.1`). The model must support Responses API Structured Outputs. Article text and submitted translations are sent to OpenAI for grading, and the Japanese article is sent to generate reverse prompts. Model requests use `store: false`.

Sessions autosave in browser storage. Signed-in sessions also sync to the `reading_sessions` table in the existing workspace SQLite database. Browser caches are separated by account; signed-out sessions stay local. **Saved sessions** restores an article snapshot, answers, grades, direction, and expanded editors. **New attempt** creates a separate session. Conflicting edits are preserved as a recovered copy; deletion markers prevent stale devices from restoring deleted sessions. Saving states report storage or sync failures and allow retrying.

Run `npm test` to check article extraction, sentence alignment, model response validation, answer edits, account isolation, revision conflicts, and persistence. These tests use synthetic article text and mocked model responses; they do not make paid OpenAI requests.

With `OPENAI_API_KEY` configured, run `READING_LIVE_EVAL=1 node --test scripts/reading-eval.test.js` to check the real model against eight translation examples: paraphrases, minor errors, kana answers, incorrect numbers, and incorrect negation. This opt-in check makes paid API requests and is skipped by default.

### Read aloud

Choose **Read aloud** inside an article to listen to the reference recording, practice one sentence, or read the whole article. The microphone needs HTTPS or localhost and a current browser with Web Audio and AudioWorklet support. Live Japanese transcription uses WebRTC; if that connection fails, recording continues and can still be reviewed when stopped. Sentence attempts stop after 90 seconds and whole-article attempts after five minutes.

Reviews give separate friendly ratings for reading accuracy, pronunciation, and pacing, with up to three specific tips. The audio model hears the actual learner recording and the available publisher recording. These are coaching judgments, not calibrated pronunciation scores. A correct transcript alone does not establish correct pronunciation. Sentence replay is enabled only where timestamped transcription can be reliably aligned with the saved article.

Feedback appears beneath the sentence it describes, using bullet points. Previous attempts are available under **Earlier feedback**; whole-article summaries stay below the article. The reference player shows how many sentences have usable playback times and offers **Retry sentence playback** when timing preparation fails or leaves sentences unmatched. Alignment combines Japanese transcription fragments into complete words before resolving readings, and preserves the original audio timestamps.

Read aloud uses `OPENAI_API_KEY`, `OPENAI_TRANSCRIPTION_MODEL` (default `gpt-live-transcribe`), and `OPENAI_AUDIO_MODEL` (default `gpt-audio-1.5`). Timestamped file transcription uses `whisper-1`; structured review formatting uses `OPENAI_MODEL` (default `gpt-4.1`). Live transcription requires Realtime API access. Audio assessment uses Chat Completions because the translation grader's text-only Responses workflow cannot assess a recording. Browser credentials expire after ten minutes and are scoped to transcription.

Learner audio is held in browser memory for playback and on the server only while a review is processed. It is sent to OpenAI for transcription and assessment, but is never added to the app's database, browser storage, or application logs. Leaving the session, cancelling, or reloading removes temporary playback. The latest 20 transcripts and reviews are saved with each Reading session and use the same account synchronization and conflict recovery as translations. Individual reviews can be deleted.

Reference MP3s are fetched only from source-discovered NHK Easier paths and cached in bounded server memory. Sentence timing metadata is stored in the separate `reading_audio_references` table, keyed by article text, sentence IDs, and audio content version. Existing saved articles gain audio metadata only when their text matches the current source. Reference failures allow coaching without reference comparison and are identified in the review.

`npm test` covers audio validation, timing alignment, transcript reconciliation, review formatting, range requests, and persistence. `scripts/read-aloud-browser-check.js` is a browser integration harness with simulated microphone and model responses; it covers retries, limits, cancellation, saved feedback, and late results after an account change. Live assessment quality must be evaluated separately with real Japanese learner recordings; mocked results do not establish pronunciation accuracy.

## Server requirements

- Translation, proofreading, selected text Q&A, and the voice speaking tutor require the dev server (`npm run dev`). Opening `dist/index.html` directly will not enable these API-backed features.
- Reading article import, dictionary lookup, reverse prompt generation, grading, and account sync also require the server. Saved local article snapshots and answers can still be opened without it.

## Notes

- Vocabulary entries are stored in SQLite when running the dev server (`data/vocab.sqlite`, override with `VOCAB_DB_PATH`). Opening `dist/index.html` directly falls back to `localStorage` under the key `jc_vocab_list`.
- Signed-in workspace data is stored in SQLite (`data/workspace.sqlite`, override with `WORKSPACE_DB_PATH`).
- Tutor v2 learning metadata is stored in the workspace SQLite database. Raw audio is stored under `TUTOR_AUDIO_DIR`; legacy v1 audio remains in its existing storage.
- The dev server persistence uses the system `sqlite3` CLI; ensure it is available on your `PATH`.
- The UI language toggle switches labels between English and Japanese.
