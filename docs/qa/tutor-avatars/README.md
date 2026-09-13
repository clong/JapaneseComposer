# Pikachu tutor verification — 12–13 September 2026

Pikachu is the only tutor character. This directory contains checks of that replacement; recordings and results for the retired human models have been removed. Browser validation uses **Google Chrome only**, as requested.

After rebasing onto current master on 13 September, the repository suite passes **129 tests**, with the existing one opt-in live-service test skipped and no failures. The build and all four Chrome application checks were rerun successfully after the rebase; the character recordings and 16 lifecycle checks below were captured on 12 September. Chrome 152.0.7977.83 passes **16 local integration checks**, and the full application passes all four preference, preview, and layout checks. Asset tests verify Pikachu's named articulation pivots, 15 speech shapes, and portrait files. See [Chrome results](pikachu-chrome-results.json) and [application results](pikachu-app-results.json).

![Pikachu in the tutor panel](pikachu.png)

## Recorded Japanese performance

| Frame | Japanese recording | Still image |
| --- | --- | --- |
| Desktop, 720 × 900 | [Play desktop performance](chromium-pikachu-desktop.webm) | [Dark theme](pikachu-dark.png) |
| Mobile, 720 × 720 | [Play mobile performance](chromium-pikachu-mobile.webm) | [390-pixel panel](pikachu-mobile.png) |

The recordings use the shipped Pikachu GLB and the prerecorded marin evaluation fixture. Each clip includes listening, preparation, Japanese vowels, closed-lip words, long vowels, pauses, an English explanation, and caption-cued greeting and explanation gestures. Recording mode captures the rendered character and audible audio branch together; no microphone or model request is used.

The [contact sheet](pikachu-contact.png) samples listening, waving, speaking, and explaining at both sizes. Inspected frames keep both ears, the tail, and paws inside the frame. The wave moves a paw away from the torso, and the explanation uses a smaller motion. A sampled blink closes both eyes without separated geometry. Mouth opening follows the audio-derived shape weights; these brief clips are not pronunciation demonstrations.

Both character clips have decodable VP8 video and an Opus audio track. [Recording results](pikachu-recording-results.json), [file hashes](pikachu-recording-manifest.json), and [media validation](pikachu-media-validation.json) identify the saved files.

The full-application check records the local preview and verifies saved motion settings after reload. See the [application recording](pikachu-app-preview.webm), [desktop screenshot](pikachu-app-desktop.png), and [mobile panel screenshot](pikachu-app-mobile.png). The application screen recording has no embedded audio track; uninterrupted playback is checked separately against the controller's audio clock.

## Speech timing and frame rate

All **12 speech trials** pass the 100 ms mouth-onset target and the 150 ms mouth-closure target. Ten voice choices are tested at normal speed; marin is also tested at 0.8× and 1.2× playback speed. The measured median render rate is **60 fps in every trial**.

| Voice / playback rate | Maximum onset after speech gate | Maximum closure after silence gate | Median render rate |
| --- | ---: | ---: | ---: |
| marin / 1× | 30.3 ms | 12.7 ms | 60 fps |
| cedar / 1× | 29.4 ms | 0.0 ms | 60 fps |
| alloy / 1× | 29.6 ms | 11.4 ms | 60 fps |
| ash / 1× | 30.5 ms | 10.5 ms | 60 fps |
| ballad / 1× | 31.8 ms | 11.5 ms | 60 fps |
| coral / 1× | 20.1 ms | 20.7 ms | 60 fps |
| echo / 1× | 31.0 ms | 10.4 ms | 60 fps |
| sage / 1× | 29.5 ms | 11.0 ms | 60 fps |
| shimmer / 1× | 20.6 ms | 11.6 ms | 60 fps |
| verse / 1× | 29.7 ms | 10.4 ms | 60 fps |
| marin / 0.8× | 79.6 ms | 10.3 ms | 60 fps |
| marin / 1.2× | 11.8 ms | 10.0 ms | 60 fps |

The [timing results](pikachu-speech-timing.json) record all trials. The harness uses the 80 ms audio delay, samples every 10 ms, and compares rendered mouth weights with the RMS-derived gate on the audible output branch. The gate includes a 35 ms silence hold. Speech bursts must last at least 100 ms and silence at least 150 ms to enter these checks. These are software measurements, not microphone measurements of sound leaving a physical speaker.

## Audio and lifecycle checks

The passing Chrome checks cover:

- Loading Pikachu without the retired appearance picker.
- Normalizing old appearance preferences without restarting audio.
- Keeping the mouth closed when captions arrive without audible speech.
- Retaining articulation with reduced motion and displaying the still portrait.
- Clearing articulation after interruption and pausing hidden rendering.
- Keeping audio connected during failed character downloads and successful retry.
- Recovering from WebGL loss after loading and during a stalled initial download.
- Aborting a stalled model request and immediately removing canvases and observers on disposal.
- Recovering from worklet failure without restarting playback.
- Keeping a conversation MediaStream connected while hidden, then resuming rendering.
- Playing local preview audio when WebGL is unavailable.
- Recovering an explicitly suspended audio context through Enable audio.
- Fitting the character panel in a 390-pixel layout without horizontal overflow.

The blocked-audio check simulates an autoplay restriction. It does not establish the behavior of every device policy. Routine tests use local recordings and mocks; real voice-service checks remain opt-in.

## Japanese classifier calibration

The replacement retains the audio-classifier model and its separate calibration and evaluation recordings. Calibration added 55 Gaussian vowel prototypes: five per voice and five pooled prototypes. Evaluation recordings never contribute training features. The zero-valued `/aa/` prediction fix remains covered by a regression test.

The existing report measures 673 energy-aligned, isolated-vowel evaluation frames. Agreement with scripted labels increased from **156/673 (23.2%)** to **318/673 (47.3%)**. These weakly aligned synthetic fixtures are not manually annotated phonetic ground truth. They do not establish connected-speech recognition accuracy. Lip sync remains an audio-derived animation approximation and must not be used as a pronunciation reference.

The [calibration report](../../../scripts/fixtures/tutor-avatar/calibration-report.json) includes per-voice and per-vowel counts. Adjacent WAV files and metadata record the exact input text, voice, model, and generation time. Evaluation recordings include パパ, ママ, パン, 東京, 高校, pauses, and an English explanation; only the initial isolated vowels receive numeric classification scores.

## Limits of this verification

No current result is claimed for another browser. A desktop Chrome window using a 390-pixel viewport exercises layout, not phone GPU performance. Physical audio synchronization, Bluetooth latency, and memory over many lesson restarts remain unmeasured. Short recorded gestures do not establish the absence of repetition during a long lesson.

Reproduction commands and controller details are in [the tutor documentation](../../tutor-avatars.md).
