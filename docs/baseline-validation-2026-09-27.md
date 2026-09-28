# Baseline validation and production reassessment status

## Production session is not yet reassessed

The requested session is `tutorv2_mukgvzp1_f2c19f67d2`. The supplied review of its visible transcript and findings is represented in regression cases. Its production database record has not been modified, and no production reassessment counts are claimed here.

Direct session-API inspection was unavailable in the signed-in browser. A production database export or the Composer SSH host and database path is still required. Deployment remains a separate action. Version 2 diagnostic state must not be written into a database still served by code that only understands version 1.

## Changes supported by the regression cases

- Optional invitations may be declined; session-status questions and already-answered objections do not become unsuccessful practice attempts.
- Listening probes include the exact supplied facts and answer key. A changed or incomplete tutor question cannot contribute learner evidence or coverage.
- Vocabulary explanations are recorded separately from sentence-construction assistance.
- Logical answers group caption fragments without replacing stored recordings or raw caption events. Protocol markers are omitted from display and assessment.
- Active time and four-area sampling coverage are separate. Time away is excluded; a pending exchange has a maximum 30-second grace period after ten active minutes.
- Metrics use valid logical answers, retain clear unsuccessful attempts in the denominator, and compare performance within the same target and difficulty. Seven-day retrieval requires actual eligible attempts, not review counters.
- Five unfinished lessons are persisted with prerequisite checks, evidence references, session duration, and two distinct independent performances per objective. Completed objectives remain separate from delayed retention.
- Reassessment preserves original records and commits replacement evidence, profile, reviews, and plan atomically. Tests cover failure, retry, concurrent duplicate requests, account isolation, and deletion-driven rebuilding.
- Failed plan preparation does not block later assessments. Retention eligibility is recomputed from surviving valid evidence, and baseline reassessment preserves unrelated benchmark history.

## Verification results

- `npm test`: 186 tests, 185 passed, one unrelated opt-in Reading test skipped.
- `npm run build`: passed.
- Chrome at 1440px and 390px: plan display, baseline status, history, learning metrics, and first-lesson creation passed without page errors or horizontal overflow. Voice connection requests were intercepted in this UI check.
- Live assessment rubric: all 11 regression examples passed, including the ambiguous restaurant prompt and missing udon listening information.
- Final synthetic Japanese speech test: five utterances assessed once each, four evidence records, no evidence for the repetition request, no checking announcements, and no duplicate practice questions. The tutor answered the learner's practice question before continuing.

Earlier speech runs exposed an ambiguous assessor instruction, a stale spoken-question reference after clarification, and redundant context after an already-spoken clarification. These paths were corrected and covered by deterministic tests. One successful run is not a statistical reliability guarantee.

The final run measured caption-to-first-audio delays of 4269, 4078, 3986, and 4392 milliseconds. The 2.5-second target is not met. This small synthetic test does not establish real-microphone performance, speaker-echo resistance, or teacher-calibrated assessment accuracy.

## Applying the production audit later

Once compatible server code is deployed separately, the session's **Re-evaluate baseline** action invokes `POST /api/tutor/v2/sessions/:id/reassess`. The operation is authenticated and idempotent. The session response exposes progress and a final audit summary; original results and recordings remain preserved. A failed attempt can be retried without applying partial profile changes.
