# Adaptive Japanese baseline

New baselines use `gpt-live-1` and a server-owned question director. Ordinary lessons retain their existing transport. A server configured with an older Realtime model returns an explicit configuration error for the new baseline instead of running it through the old checklist.

## Conversation and evidence

The first question asks the learner's name and accepts a name alone. Four separate probe tracks sample interaction, productive vocabulary, sentence construction, and listening. Two independent successes on distinct questions permit a harder probe in that track. A first unsuccessful answer triggers a hint on the same question; supported performance is recorded separately from independent performance. Requests for help, questions about the tutor, unfinished clauses, and uncertain audio do not create failed-task evidence.

The diagnostic targets eight to ten active minutes. It can finish after eight minutes when each track has at least two distinct question samples. At ten minutes it ends even if coverage is incomplete, reporting the uncertainty. Stopping early pauses the same baseline; resuming preserves its evidence and pending question. These thresholds define sampling coverage, not a validated CEFR certification.

`DiagnosticState` and `DiagnosticEvidence` use version 1, stored in the existing session's `activity_state` JSON. The idempotent migration marker is `tutor_v2_005_adaptive_diagnostic`. Each evidence record contains the question ID, activity revision, logical answer ID and revision, actual prompt, combined answer, assistance, outcome, confidence, and progression decision. No new audio format or retention policy is introduced.

Unknown assessment dimensions remain null. Transcript-only baselines do not award pronunciation or measured-fluency scores. Progress reports include actual answer examples and distinguish independent performance, performance with help, repeated difficulty, and untested skills. Older baseline records remain readable and are labeled limited evidence; their assessments are excluded when rebuilding mastery after a deletion.

## Turn handling and API changes

`scripts/tutor-diagnostic-director.js` collects caption fragments into a logical answer for the pending question. It recovers stable answers even when Live does not delegate. A late caption or renewed speech invalidates in-flight assessment before it can update mastery. Duplicate caption and delegation IDs cannot create a second assessment. Incomplete answers wait for additional speech or an explicit handoff. Silence does not create an attempt.

The compact intent/task assessment runs separately from queued SQLite persistence. Results are sent with quiet `session.thinking.append` context and a single `session.commentary.append` speaking task. Explicit Repeat, Hint, and Explain actions may redirect speech. Assessment requests time out after eight seconds and retry once; continued failure retains the answer, offers the same question again, and exposes a retry status instead of awarding evidence.

Existing routes remain. Additions and response fields are:

- `POST /api/tutor/v2/sessions/:id/control` accepts `handoff`, `repeat`, `hint`, or `explain`.
- `POST /api/tutor/v2/diagnostic` accepts `resumeSessionId` for an owned, incomplete adaptive baseline.
- `/today` returns `resumeBaselineId`.
- Session and progress responses include diagnostic coverage, provisional findings, and a completion reason. Session responses also include director processing status.
- Direct client assessment submissions for adaptive baselines return 409; the server director owns their question and answer revisions.

The bounded event trace records assessment timing, question and answer revisions, outbound control content, discarded work, and progression reasons. Stop, deletion, and service shutdown drain pending diagnostic writes. Deleting a session rebuilds the profile and reviews from remaining evidence.

## Verification commands and current limits

Run `npm test` and `npm run build` for deterministic regressions and build verification. The regression corpus includes the September 26 production failure: a name answer, the question about checking answers, and a split introduction. SQLite integration covers stop, resume, reconnect, and deletion.

Live tests are opt-in and billable. Load secrets through Node's environment-file support; never display the file:

```sh
TUTOR_DIAGNOSTIC_LIVE=1 node --env-file=data/local.env scripts/tutor-diagnostic-model-check.js
TUTOR_DIAGNOSTIC_LIVE=1 node --env-file=data/local.env scripts/tutor-diagnostic-smoke.js
```

The speech smoke test requires macOS `say` with the Kyoko voice. It sends five synthetic Japanese turns, including a repetition request, over an actual Live WebSocket; it does not use the microphone. It checks finalization, usable output audio, no assessment announcements, no duplicate practice questions, and no evidence for the help request. The model check is a small regression corpus, not a calibrated proficiency evaluation.

For browser checks, first start the dev server with `data/local.env`, `REQUIRE_GOOGLE_AUTH=0`, and isolated temporary `WORKSPACE_DB_PATH`, `VOCAB_DB_PATH`, and `TUTOR_AUDIO_DIR`. Then run:

```sh
TUTOR_DIAGNOSTIC_BROWSER=1 TUTOR_DIAGNOSTIC_URL=http://localhost:5174 node scripts/tutor-diagnostic-browser.js
```

This creates and deletes one empty local baseline and checks history and progress at desktop and mobile widths. It does not connect to a voice session or modify production data.

The measured answer-caption-to-first-audio latency was 3.4-4.0 seconds in one corrected five-turn smoke and 3.4-8.2 seconds in a later run. The p95 target below 2.5 seconds is not met. This is caption/control telemetry, not a calibrated end-of-speech latency measurement. Synthetic speech and deterministic tests do not establish performance on real microphones, speaker echo, accents, or an expert-labeled proficiency corpus. Live remains a generative speech model: prompt constraints and regression checks reduce unwanted narration but do not provide a formal guarantee for every future conversation.
