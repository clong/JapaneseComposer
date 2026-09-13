export const TUTOR_AVATARS = Object.freeze([
  Object.freeze({
    id: 'pikachu', name: 'Pikachu', japaneseName: 'ピカチュウ', color: '#b8890f',
    model: './assets/tutor/pikachu.glb', portrait: './assets/tutor/pikachu.webp', thumbnail: './assets/tutor/pikachu-thumb.webp'
  })
]);
export const VISEMES = Object.freeze(['aa', 'E', 'I', 'O', 'U', 'PP', 'SS', 'TH', 'DD', 'FF', 'kk', 'nn', 'RR', 'CH', 'sil']);
export const normalizeTutorAvatarId = (id) => TUTOR_AVATARS.some((a) => a.id === id) ? id : 'pikachu';
export const normalizeTutorAvatarMotion = (motion) => ['auto', 'reduced', 'off'].includes(motion) ? motion : 'auto';
export const getTutorAvatar = (id) => TUTOR_AVATARS.find((a) => a.id === normalizeTutorAvatarId(id));

export function resolveAvatarMotion(preference, reducedMotion = false) {
  return preference === 'off' ? 'off' : preference === 'reduced' || reducedMotion ? 'reduced' : 'auto';
}

// Caption cues affect gestures only. Audio is the sole source of articulation.
export function captionGesture(text = '') {
  const value = String(text).trim();
  if (/^(こんにちは|こんばんは|おはよう|hello\b|hi\b)/i.test(value)) return 'greeting';
  if (/^(ありがとう|thank you\b)/i.test(value)) return 'acknowledge';
  if (/^(たとえば|例えば|つまり|for example\b|this means\b)/i.test(value)) return 'explain';
  if (/[?？]$/.test(value)) return 'invite';
  return null;
}

export class TutorMotionDirector {
  constructor() { this.reset(); }
  reset() { this.pending = null; this.lastGestureAt = -Infinity; this.lastAssessment = ''; }
  cue(kind, at, { confirmed = false } = {}) {
    if (kind === 'success' && !confirmed) return;
    if (['greeting', 'acknowledge', 'explain', 'invite', 'success'].includes(kind)) this.pending = { kind, at };
  }
  take(at, speaking, motion) {
    const pending = this.pending;
    if (!pending) return null;
    if (at - pending.at > 750 || motion !== 'auto') { this.pending = null; return null; }
    if (!speaking || at - this.lastGestureAt < 5000) return null;
    this.pending = null;
    this.lastGestureAt = at;
    return pending.kind;
  }
}

// Independent of rendering and worklet timing, so silence cannot leave an open mouth.
export class TutorArticulation {
  constructor() { this.reset(); }
  reset() { this.weights = Object.fromEntries(VISEMES.map((v) => [`viseme_${v}`, 0])); this.lastFrameAt = -Infinity; }
  set(key, value, at) {
    if (!(key in this.weights)) return;
    this.weights[key] = Number.isFinite(value) && value >= .0001 ? Math.min(1, value) : 0;
    this.lastFrameAt = at;
  }
  sample(at, audible) {
    if (!audible || at - this.lastFrameAt > 180) return Object.fromEntries(VISEMES.map((v) => [`viseme_${v}`, 0]));
    return { ...this.weights };
  }
}
