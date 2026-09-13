import { TutorArticulation } from './tutor-avatar-model.js';

// Owns the single audible path. It is deliberately independent of the 3D renderer.
export function createTutorAvatarAudio({ audioElement, onLevel = () => {}, onChange = () => {}, delayMs = 80 } = {}) {
  let context, source, delay, gain, analyser, worklet, timer, bufferSource, capture;
  let generation = 0, disposed = false, kind = null, lastNonSilent = -Infinity;
  let ready = null, workletModule = null, previewRequest = null, retrying = false, moduleAttempt = 0;
  const articulation = new TutorArticulation();
  const status = { active: false, audible: false, level: 0, mode: 'idle', blocked: false, error: '' };
  const report = (patch) => { Object.assign(status, patch); onChange({ ...status }); };

  function prepare() {
    if (disposed) return Promise.reject(new Error('Audio controller was disposed.'));
    const Constructor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Constructor) return Promise.reject(new Error('Web Audio is unavailable.'));
    context ||= new Constructor({ latencyHint: 'interactive' });
    // Call resume synchronously from a click, before model/network work begins.
    void context.resume().catch(() => report({ blocked: true }));
    if (!ready) ready = (async () => {
      if (!context.audioWorklet || !globalThis.AudioWorkletNode) return false;
      try {
        const url = new URL('./vendor/headaudio/headworklet.mjs', import.meta.url);
        if (moduleAttempt) url.searchParams.set('attempt', String(moduleAttempt));
        await context.audioWorklet.addModule(url);
        workletModule = await import('./vendor/headaudio/headaudio.mjs');
        return true;
      } catch { return false; }
    })();
    // A stalled module must never hold the tutor's audible playback hostage.
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 2500);
      ready.then((value) => { clearTimeout(timeout); resolve(value); });
    });
  }

  function stop() {
    generation += 1;
    previewRequest?.abort(); previewRequest = null;
    clearInterval(timer); timer = null;
    try { bufferSource?.stop(); } catch { /* Already ended. */ }
    if (bufferSource) bufferSource.onended = null;
    bufferSource = null;
    for (const node of [source, delay, gain, analyser, worklet]) {
      try { node?.disconnect(); } catch { /* Already disconnected. */ }
    }
    if (worklet) { worklet.stop(); worklet.port.onmessage = null; worklet.port.close(); }
    source = delay = gain = analyser = worklet = null;
    if (audioElement) { audioElement.pause(); audioElement.srcObject = null; audioElement.muted = false; }
    kind = null;
    lastNonSilent = -Infinity;
    articulation.reset();
    onLevel(0);
    report({ active: false, audible: false, level: 0, mode: 'idle', blocked: false, error: '' });
  }

  async function attachAnalysis(token) {
    let candidate;
    try {
      candidate = new workletModule.HeadAudio(context, { parameterData: {
        silMode: 0, vadGateActiveDb: -48, vadGateInactiveDb: -55, vadGateInactiveMs: 20
      } });
      await Promise.race([
        candidate.loadModel(new URL('./vendor/headaudio/model-ja-en.bin', import.meta.url)),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Analysis model timed out.')), 2500))
      ]);
      if (token !== generation || disposed) { candidate.stop(); candidate.port.close(); return false; }
      worklet = candidate;
      candidate.onvalue = (key, value) => articulation.set(key, value, performance.now());
      candidate.onprocessorerror = () => {
        if (token !== generation || worklet !== candidate) return;
        source.disconnect(candidate); candidate.disconnect(); candidate.port.close();
        worklet = null; articulation.reset(); report({ mode: 'portrait' });
      };
      delay.delayTime.value = Math.max(0, Math.min(100, delayMs)) / 1000;
      source.connect(candidate);
    } catch {
      candidate?.disconnect(); candidate?.port.close();
      if (token !== generation || disposed) return false;
      worklet = null;
      delay.delayTime.value = 0;
    }
  }

  async function retryAnalysis() {
    if (!source || worklet || disposed || retrying) return;
    const token = generation;
    retrying = true;
    try {
      if (!workletModule) { ready = null; moduleAttempt++; }
      const available = await prepare();
      if (token !== generation || disposed) return;
      if (available) await attachAnalysis(token);
      if (token === generation && !disposed) report({ mode: worklet ? 'visemes' : 'portrait' });
    } finally { retrying = false; }
  }

  async function connect(makeSource, token) {
    const preparation = prepare();
    if (token !== generation || disposed) return false;
    source = makeSource(context);
    delay = context.createDelay(.1);
    delay.delayTime.value = Math.max(0, Math.min(100, delayMs)) / 1000;
    gain = context.createGain();
    analyser = context.createAnalyser(); analyser.fftSize = 512;
    source.connect(delay); delay.connect(gain); gain.connect(analyser); analyser.connect(context.destination);
    report({ active: true, mode: 'preparing', blocked: context.state !== 'running' });
    const hasWorklet = await preparation;
    if (token !== generation || disposed) return false;
    if (hasWorklet) await attachAnalysis(token);
    if (token !== generation || disposed) return false;
    if (capture) gain.connect(capture);
    const samples = new Float32Array(analyser.fftSize);
    let previous = performance.now();
    timer = setInterval(() => {
      const now = performance.now();
      worklet?.update(Math.min(40, now - previous)); previous = now;
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((total, sample) => total + sample * sample, 0) / samples.length);
      const level = Math.min(1, rms * 7);
      if (rms > .003) lastNonSilent = now;
      const audible = context.state === 'running' && now - lastNonSilent < 35;
      status.level = level;
      onLevel(level);
      if (status.audible !== audible) report({ audible });
    }, 20);
    report({ active: true, blocked: context.state !== 'running', mode: worklet ? 'visemes' : 'portrait', error: '' });
    return true;
  }

  async function attachStream(stream) {
    stop(); kind = 'stream'; const token = generation;
    if (audioElement) {
      audioElement.srcObject = stream; audioElement.muted = true;
      void audioElement.play().catch(() => {}); // Enables remote-track processing in Chromium.
    }
    try {
      await connect((ctx) => ctx.createMediaStreamSource(stream), token);
    } catch {
      if (token !== generation || disposed) return;
      // Restore the native element only after disconnecting any partial graph.
      stop(); kind = 'stream';
      if (!audioElement) { report({ error: 'Tutor audio is unavailable.' }); return; }
      audioElement.srcObject = stream; audioElement.muted = false;
      try { await audioElement.play(); report({ active: true, mode: 'portrait' }); }
      catch { report({ active: true, mode: 'portrait', blocked: true, error: 'Tap to enable tutor audio.' }); }
    }
  }

  async function preview(url = './assets/tutor/preview-ja.wav', { rate = 1 } = {}) {
    if (kind === 'stream') return;
    stop(); kind = 'preview'; const token = generation;
    try {
      const preparation = prepare();
      previewRequest = new AbortController();
      const response = await fetch(url, { signal: previewRequest.signal });
      if (!response.ok) throw new Error('The preview recording could not be loaded.');
      const bytes = await response.arrayBuffer(); await preparation;
      if (token !== generation || disposed) return;
      const buffer = await context.decodeAudioData(bytes);
      if (token !== generation || disposed) return;
      await connect((ctx) => {
        bufferSource = ctx.createBufferSource(); bufferSource.buffer = buffer;
        bufferSource.playbackRate.value = Math.max(.75, Math.min(1.25, Number(rate) || 1));
        return bufferSource;
      }, token);
      if (token !== generation || !bufferSource) return;
      bufferSource.onended = () => { if (token === generation) setTimeout(() => { if (token === generation) stop(); }, delayMs + 30); };
      bufferSource.start();
    } catch (error) {
      if (token !== generation) return;
      stop(); report({ error: error.message });
    }
  }

  async function resume() {
    try {
      if (source && context) await context.resume();
      else if (audioElement?.srcObject) await audioElement.play();
      report({ blocked: false, error: '' });
    } catch { report({ blocked: true, error: 'Tap to enable tutor audio.' }); }
  }

  return {
    prepare, attachStream, preview, stop, resume, retryAnalysis,
    get state() { return { ...status, kind, contextState: context?.state || 'uninitialized', playbackTime: context?.currentTime || 0 }; },
    captureOutput() {
      if (!context) throw new Error('Prepare audio before recording.');
      if (!capture) { capture = context.createMediaStreamDestination(); gain?.connect(capture); }
      return capture.stream;
    },
    sample() { return articulation.sample(performance.now(), status.audible); },
    async dispose() { stop(); disposed = true; if (context && context.state !== 'closed') await context.close(); }
  };
}
