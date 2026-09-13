import { getTutorAvatar, normalizeTutorAvatarId, normalizeTutorAvatarMotion,
  resolveAvatarMotion, captionGesture, TutorMotionDirector } from './tutor-avatar-model.js';
import { createTutorAvatarAudio } from './tutor-avatar-audio.js';

const copy = {
  en: { preview: 'Meet Pikachu', stop: 'Stop preview', retry: 'Reload character',
    loading: 'Pikachu is getting ready…', failure: 'The 3D character could not load. You can keep talking.',
    analysisFailure: 'Animation is unavailable. Your tutor audio can continue.',
    motion: 'Animation', auto: 'Natural', reduced: 'Reduced motion', off: 'Still portrait',
    audio: 'Enable audio', label: 'Your practice companion', local: 'ピカチュウ',
    note: 'A prerecorded Japanese greeting. No microphone needed.',
    previewCaption: 'Hello. Let’s practice Japanese together. Take your time. · AI-generated voice', portrait: 'Portrait mode',
    state: { idle: 'Ready when you are', listening: 'Listening to you', preparing: 'Preparing a response', speaking: 'Speaking', correction: 'Let’s practice that together', completion: 'Practice complete' } },
  ja: { preview: 'ピカチュウのあいさつ', stop: 'プレビューを停止', retry: '再読み込み',
    loading: 'ピカチュウを準備中…', failure: '3Dキャラクターを読み込めませんでした。会話は続けられます。',
    analysisFailure: 'アニメーションを利用できません。音声での会話は続けられます。',
    motion: 'アニメーション', auto: '自然な動き', reduced: '動きを減らす', off: '静止画', audio: '音声を有効にする',
    label: '練習のパートナー', local: 'Pikachu', note: '録音された日本語のあいさつです。マイクは使いません。',
    previewCaption: 'こんにちは。一緒に日本語を練習しましょう。ゆっくりで大丈夫です。 · AI生成音声', portrait: '静止画モード',
    state: { idle: 'いつでもどうぞ', listening: '聞いています', preparing: '返答を準備中', speaking: '話しています', correction: '一緒に練習しましょう', completion: '練習完了' } }
};

export function createTutorAvatar({ root, audioElement, onPreferenceChange = () => {}, onLevel = () => {} }) {
  const q = (selector) => root.querySelector(selector);
  const stage = q('[data-avatar-stage]'), portrait = q('[data-avatar-portrait]');
  const message = q('[data-avatar-message]'), retry = q('[data-avatar-retry]'), preview = q('[data-avatar-preview]');
  const motionSelect = q('[data-avatar-motion]');
  const enableAudio = q('[data-avatar-enable-audio]');
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const director = new TutorMotionDirector();
  let renderer = null, rendererId = '', rendererModule, pendingLoad = null, loadingId = '', failedId = '', revision = 0, disposed = false;
  let avatarId = 'pikachu', motion = 'auto', language = 'en', active = false, state = 'idle', error = '', live = false;
  let lastCaptionId = '', lastAssessmentId = '', captionText = '', captionAt = 0, lastCue = '', tick;
  const audio = createTutorAvatarAudio({ audioElement, onLevel,
    onChange() { if (!disposed) { if (!audio.state.active) { director.reset(); renderer?.reset(); } refreshLabels(); updateVisibility(); } }
  });

  function currentMotion() { return resolveAvatarMotion(motion, media.matches); }
  function refreshLabels() {
    const c = copy[language], avatar = getTutorAvatar(avatarId), a = audio.state;
    q('[data-avatar-eyebrow]').textContent = c.label;
    q('[data-avatar-name]').textContent = language === 'ja' ? avatar.japaneseName : avatar.name;
    const analysisUnavailable = a.active && a.mode === 'portrait';
    q('[data-avatar-subtitle]').textContent = currentMotion() === 'off' || analysisUnavailable ? c.portrait : c.local;
    q('[data-avatar-note]').textContent = c.note;
    q('[data-avatar-motion-label]').textContent = c.motion;
    for (const option of motionSelect.options) option.textContent = c[option.value];
    motionSelect.value = motion;
    preview.textContent = a.kind === 'preview' ? c.stop : c.preview;
    preview.disabled = live;
    retry.textContent = c.retry;
    retry.hidden = !error && !analysisUnavailable;
    enableAudio.textContent = c.audio;
    enableAudio.hidden = !a.blocked;
    const nextMessage = error ? c.failure : loadingId ? c.loading : a.error || (analysisUnavailable ? c.analysisFailure : '');
    if (message.textContent !== nextMessage) message.textContent = nextMessage;
    message.hidden = !message.textContent;
    q('[data-avatar-status]').textContent = c.state[a.audible ? 'speaking' : state];
    q('[data-avatar-preview-caption]').textContent = a.kind === 'preview' ? c.previewCaption : '';
    q('[data-avatar-preview-caption]').hidden = a.kind !== 'preview';
    root.dataset.state = a.audible ? 'speaking' : state;
    root.style.setProperty('--avatar-accent', avatar.color);
    if (portrait.getAttribute('src') !== avatar.portrait) portrait.src = avatar.portrait;
    portrait.alt = `${language === 'ja' ? avatar.japaneseName : avatar.name}`;
  }

  function updateVisibility() {
    const show = active && !document.hidden && currentMotion() !== 'off';
    const lipSyncUnavailable = audio.state.active && audio.state.mode === 'portrait';
    const render = show && !lipSyncUnavailable && !error;
    root.classList.toggle('has-avatar-renderer', Boolean(renderer) && render && !error);
    renderer?.setVisible(render);
    renderer?.setMotion(currentMotion());
    if (show && !disposed && !loadingId && !failedId && rendererId !== avatarId) void select(avatarId);
  }

  async function select(id, force = false) {
    if (disposed) return;
    const token = ++revision;
    pendingLoad?.abort(); pendingLoad = null;
    avatarId = normalizeTutorAvatarId(id);
    loadingId = ''; error = ''; failedId = ''; refreshLabels();
    if (!active || currentMotion() === 'off' || (rendererId === avatarId && !force)) { updateVisibility(); return; }
    loadingId = avatarId; error = ''; failedId = ''; refreshLabels();
    const node = document.createElement('div'); node.className = 'tutor-avatar-canvas is-loading';
    stage.append(node);
    const load = new AbortController(); pendingLoad = load;
    const removePendingNode = () => node.remove();
    load.signal.addEventListener('abort', removePendingNode, { once: true });
    let candidate;
    try {
      rendererModule ||= import('./tutor-avatar-renderer.js').catch((error) => { rendererModule = null; throw error; });
      const { createTutorAvatarRenderer } = await rendererModule;
      if (token !== revision || disposed || load.signal.aborted) { node.remove(); return; }
      const selectedId = avatarId;
      candidate = await createTutorAvatarRenderer(node, getTutorAvatar(selectedId), {
        signal: load.signal,
        sample: () => ({ audible: audio.state.audible, weights: audio.sample() }),
        onError: () => {
          if (token !== revision || disposed || load.signal.aborted || rendererId !== selectedId) return;
          error = 'graphics'; failedId = selectedId; renderer?.dispose(); renderer = null; rendererId = '';
          refreshLabels(); updateVisibility();
        }
      });
      if (token !== revision || disposed || load.signal.aborted) { candidate.dispose(); return; }
      renderer?.dispose(); renderer = candidate; rendererId = selectedId;
      node.classList.remove('is-loading');
      renderer.setState(state);
    } catch (failure) {
      candidate?.dispose(); node.remove();
      if (token === revision && !disposed && !load.signal.aborted) { failedId = avatarId; error = failure.message; }
    } finally {
      load.signal.removeEventListener('abort', removePendingNode);
      if (pendingLoad === load) pendingLoad = null;
      if (token === revision && !disposed) { loadingId = ''; refreshLabels(); updateVisibility(); }
    }
  }

  function changeMotion() { motion = normalizeTutorAvatarMotion(motionSelect.value); refreshLabels(); updateVisibility(); onPreferenceChange({ avatarMotion: motion }); }
  function retryLoad() {
    if (audio.state.active && audio.state.mode === 'portrait') void audio.retryAnalysis();
    if (error || !renderer) { failedId = ''; void select(avatarId, true); }
  }
  function previewClick() { if (audio.state.kind === 'preview') audio.stop(); else { void audio.preview(); director.cue('greeting', performance.now()); } }
  function resumeAudio() { void audio.resume(); }
  function visibility() { director.reset(); if (!active && audio.state.kind === 'preview') audio.stop(); updateVisibility(); }
  function mediaChange() { refreshLabels(); updateVisibility(); }
  motionSelect.addEventListener('change', changeMotion); retry.addEventListener('click', retryLoad);
  preview.addEventListener('click', previewClick); enableAudio.addEventListener('click', resumeAudio);
  document.addEventListener('visibilitychange', visibility); media.addEventListener('change', mediaChange);
  tick = setInterval(() => {
    if (!active || document.hidden) return;
    const gesture = director.take(performance.now(), audio.state.audible, currentMotion());
    if (gesture) renderer?.gesture(gesture);
  }, 60);

  return {
    prepareAudio: () => audio.prepare().catch(() => false),
    attachAudio: (stream) => audio.attachStream(stream),
    captureAudio: () => audio.captureOutput(),
    captureFrame: () => renderer?.captureFrame(),
    previewAudio: (url, options) => audio.preview(url, options),
    stopAudio() { audio.stop(); director.reset(); renderer?.reset(); lastCaptionId = ''; captionText = ''; lastCue = ''; },
    update(values = {}) {
      language = values.language === 'ja' ? 'ja' : 'en';
      const wasActive = active;
      active = Boolean(values.active); live = Boolean(values.live);
      motion = normalizeTutorAvatarMotion(values.avatarMotion);
      const nextId = normalizeTutorAvatarId(values.avatarId);
      if (nextId !== avatarId) { failedId = ''; void select(nextId); }
      state = values.activityState?.status === 'completed' ? 'completion'
        : values.status === 'thinking' || values.status === 'connecting' || values.status === 'planning' ? 'preparing'
        : values.activityState?.repairRequired ? 'correction'
        : values.status === 'listening' || values.status === 'speaking' ? 'listening' : 'idle';
      const assessment = values.latestAssessment;
      if (assessment?.id && assessment.id !== lastAssessmentId) {
        lastAssessmentId = assessment.id;
        if (assessment.taskCompleted === true && !values.activityState?.repairRequired) director.cue('success', performance.now(), { confirmed: true });
      }
      renderer?.setState(state); refreshLabels(); if (wasActive !== active) visibility(); else updateVisibility();
    },
    caption(event) {
      if (!active || document.hidden) return;
      const id = event.event_id || '';
      if (id && id === lastCaptionId) return;
      lastCaptionId = id;
      const now = performance.now();
      if (now - captionAt > 1500) { captionText = ''; lastCue = ''; }
      captionAt = now;
      captionText = `${captionText}${event.delta || event.transcript || ''}`.slice(-240);
      const gesture = captionGesture(captionText);
      if (gesture && gesture !== lastCue) { director.cue(gesture, now); lastCue = gesture; }
      if (/[。.!?？]\s*$/.test(captionText)) { captionText = ''; lastCue = ''; }
    },
    get diagnostics() { return { avatarId, rendererId, motion: currentMotion(), audio: audio.state, weights: audio.sample(), rendered: renderer?.articulation, stats: renderer?.stats, error }; },
    async dispose() {
      disposed = true; revision++; clearInterval(tick);
      pendingLoad?.abort(); pendingLoad = null;
      motionSelect.removeEventListener('change', changeMotion); retry.removeEventListener('click', retryLoad);
      preview.removeEventListener('click', previewClick); enableAudio.removeEventListener('click', resumeAudio);
      document.removeEventListener('visibilitychange', visibility); media.removeEventListener('change', mediaChange);
      renderer?.dispose(); await audio.dispose();
    }
  };
}
