# Vendored HeadAudio

Source: https://github.com/met4citizen/HeadAudio
Revision: d3af5f9ff86ab6b2b1913d411a4e1922ec101953
License: MIT; the original license is included in this directory.

Only the worklet, classifier, feature extraction, model loader, and stock English
prototype model are bundled. The upstream demo and its external services are not used.

Local changes: `headaudio.mjs` accepts zero as a valid viseme ID and bounds-checks
predictions. The original truthiness check discarded /aa/. Trailing whitespace
was removed from the vendored JavaScript modules. Application lifecycle,
silence gating, and animation timing live outside the vendored implementation.

Japanese Composer also bundles `model-ja-en.bin`: the stock English prototypes plus Japanese vowel prototypes fitted from separate synthetic calibration recordings. `scripts/tutor-avatar-calibration.js` rebuilds it and evaluates independent recordings. This does not make the avatar a pronunciation reference. The worklet has no network, storage, microphone, or external-service access; the main thread loads only the bundled model.
