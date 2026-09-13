# Pikachu tutor rendering and audio

The Tutor page uses one local Pikachu character. The previous Haru, Aoi, Ren, and Mika choices and their picker have been removed. Appearance does not change the selected voice, lesson, or learning history. The Japanese preview is a bundled, disclosed AI-generated recording; playing it requires neither the microphone nor a model request.

## The controller keeps rendering independent of audio

`src/tutor-avatar.js` owns character loading, captions, lesson events, motion settings, visibility, and fallback UI. It exposes `update`, `attachAudio`, `prepareAudio`, `caption`, `stopAudio`, and `dispose`. The local QA harness also uses `previewAudio`, `captureAudio`, `captureFrame`, and `diagnostics`. An AbortController cancels a pending download and releases its canvas and observers on disposal. A generation counter prevents a superseded result from being committed. Context loss during initialization rejects that load and exposes portrait/retry recovery.

`src/tutor-avatar-renderer.js` loads the Pikachu GLB with Three.js 0.180.0 and controls the character's articulation and motion. The GLTFLoader adapter enables Three's bundled Meshopt decoder. The renderer and model load when the Tutor opens; character-authoring tools do not run in the browser. Disposal releases the canvas, geometry, textures, observers, and listeners.

`src/tutor-avatar-audio.js` owns one audible path:

```
Tutor MediaStream or prerecorded AudioBuffer
  ├── HeadAudio AudioWorklet → eased mouth-shape weights → character
  └── DelayNode (80 ms) → gain → RMS analyser → speakers
```

The remote HTML audio element is muted when Web Audio is active. It enables remote-track processing in Chromium and provides native playback if Web Audio is unavailable. It does not provide a second audible output. The worklet has no outputs. Its module, feature extractor, classifier, and model are served from local assets. The optional recording destination is created only by the QA harness.

The audio delay is clamped to 0–100 ms through the audio controller's `delayMs` option. HeadAudio blends mouth-shape weights over 100 ms. Output RMS closes the mouth during audible pauses; values smaller than 0.0001 become exactly zero. Stopping resets articulation, disconnects nodes, closes worklet ports, aborts pending preview fetches, and cancels gesture cues.

Captions may cue a greeting, invitation, explanation, or acknowledgement, but cannot open the mouth. Success gestures require a confirmed `taskCompleted` lesson assessment. Gestures have a five-second cooldown, cues expire after 750 ms, and speech termination clears pending motion. Normal short pauses close the mouth while allowing an already-started gesture to finish. Corrections select an attentive expression. Mouth expressions remain separate from articulation.

## Preferences retain existing account records

The existing account preferences JSON stores `avatarId` and `avatarMotion`. The only supported appearance ID is `pikachu`; missing IDs, retired human IDs, and unknown values normalize to that ID. Missing motion preferences normalize to `auto`. No database migration is required. Browser preferences use `jc_tutor_avatar` and `jc_tutor_avatar_motion`. Preference writes are serialized so a slower request cannot overwrite a newer setting.

- `auto` uses natural motion and respects `prefers-reduced-motion`.
- `reduced` retains speech articulation while suppressing conversational body gestures and gaze drift.
- `off` displays Pikachu's portrait.

WebGL failure, context loss, and failed character downloads show a portrait with a retry button. Worklet failure leaves audio connected and switches to the portrait. Retry attaches a replacement analysis node without restarting playback. Blocked playback exposes an Enable audio button. A hidden page pauses rendering and clears stale motion while leaving the conversation stream connected. Microphone mute does not control the avatar's audio analysis.

## Japanese calibration remains an approximation

The vendored HeadAudio revision is `d3af5f9ff86ab6b2b1913d411a4e1922ec101953`. Its original classifier was trained on English. The `/aa/` prediction has numeric ID zero; the upstream truthiness check discarded it. The vendored fix accepts bounded integer IDs and has a regression test.

`scripts/fixtures/tutor-avatar` contains separate calibration and evaluation WAV recordings for all ten existing voice IDs. Calibration recordings sustain Japanese vowels and include deliberate silence. Evaluation recordings use shorter vowels, closed-lip words such as パパ and ママ, long vowels in 東京 and 高校, pauses, and an English explanation. Metadata records the speech model, voice, exact text, and generation time. These synthetic TTS fixtures do not certify the live voice service or every Japanese accent.

The calibration script extracts MFCC features from the interior of energy-aligned vowel segments. It adds five prototypes per voice and five pooled prototypes to the stock English model. Evaluation recordings never contribute training features. Segment counts that do not match the script are rejected for training. Energy alignment is approximate, and the isolated-vowel scores are not a phonetic transcription or a connected-speech accuracy claim. Lip sync is an animation effect, not a pronunciation reference.

## Reproduce local browser and audio checks

Routine commands use local recordings and mocks:

```sh
npm ci
npm test
npm run test:avatar:calibration
npm run test:avatar:browser
TUTOR_AVATAR_RECORD=1 node scripts/tutor-avatar-browser.js
TUTOR_AVATAR_SPEECH=1 node scripts/tutor-avatar-browser.js
```

Browser checks use installed Google Chrome only. Alternative browser channels and executable overrides are rejected. Playwright 1.63.0 avoids an AudioWorklet startup hang present in the older 1.55 test runner. Browser results and recordings default to `/tmp/jc-avatar-qa`; override `TUTOR_AVATAR_QA_DIR` to keep independent runs.

The browser harness verifies one Pikachu model, absence of the retired picker, normalization of old preferences without restarting audio, caption-only silence, motion preferences, interruption, failed-download recovery, context loss, mobile layout, worklet retry, background audio, unavailable WebGL, autoplay recovery, and disposal. Recording mode saves separate desktop and mobile Japanese performances with the marin evaluation fixture. It includes listening, preparation, speaking, greeting, explanation, and completion.

The timing harness measures rendered mouth weights against RMS of the audible output branch. It checks speech bursts lasting at least 100 ms and silence lasting at least 150 ms. It does not treat a gap shorter than a rendered frame as a sustained silence failure. Physical speaker latency, Bluetooth latency, and live network timing require device measurements. A 390-pixel desktop viewport does not establish iPhone GPU performance.

For a full application check, start an isolated local server with temporary databases and no speech-service credentials, then run `TUTOR_AVATAR_APP_URL=http://localhost:5188 node scripts/tutor-avatar-app-browser.js`. This seeds a retired local appearance preference, verifies Pikachu and motion persistence after reload, records the Japanese preview, and checks the mobile layout. It changes the isolated server's anonymous preferences. Current results and remaining device coverage are recorded in [the Pikachu QA record](qa/tutor-avatars/README.md).

## Production assets and offline tools

The production asset set consists of `pikachu.glb`, its portrait and thumbnail, the Japanese preview, worklet modules, classifier models, and dependency notices. Source and attribution details belong in `src/assets/tutor/PROVENANCE.md` and `THIRD_PARTY_NOTICES.md`. The previously shipped MPFB human models do not describe the current Pikachu asset.

Build the model with the offline Blender script, then optimize it. The optimizer defaults to Pikachu and can accept explicit character IDs:

```sh
blender --background --factory-startup --python scripts/build-pikachu.py -- /tmp/tutor-exports
node scripts/optimize-tutor-characters.js /tmp/tutor-exports
npm run build
TUTOR_AVATAR_PORTRAITS=1 node scripts/tutor-avatar-browser.js
npm run build
```

The Blender script generates the character surfaces, 15 speech shapes on the head, mouth, and tongue, and separate pivots for the head, body, ears, arms, eyes, and tail. It saves both an editable `.blend` scene and a GLB. The optimizer preserves the node hierarchy and morph targets, compresses geometry with Meshopt, and converts embedded textures to WebP. The portrait pass renders the finished model with a transparent background and preserves its ears and tail in the thumbnail. Blender, glTF Transform, Playwright, and Sharp are authoring or test tools, outside the production runtime.

`npm run build` copies the local assets and dependency notices into `dist`. The application server serves `.mjs` as JavaScript and has MIME types for GLB, WebP, and WAV. Docker's production dependency installation can build and serve the checked-in assets without authoring tools. `.dockerignore` excludes local dependencies, authoring scripts, calibration fixtures, and QA recordings from the production image.

Generating replacement speech is a separate opt-in operation requiring `OPENAI_API_KEY` in the environment:

```sh
node scripts/tutor-avatar-recordings.js --generate
node scripts/tutor-avatar-recordings.js --generate --corpus
node scripts/tutor-avatar-calibration.js --write
```

The generator preserves existing recordings. Generation calls the paid speech API; ordinary builds and tests do not.
