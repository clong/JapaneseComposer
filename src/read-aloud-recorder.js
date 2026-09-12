import { encodeWav } from './read-aloud-wav.js';
import { LiveTranscript } from './read-aloud-model.js';

const processorCode = `class ReadingCapture extends AudioWorkletProcessor {
  constructor() { super(); this.parts = []; this.count = 0; this.port.onmessage = () => { this.flush(); this.port.postMessage({ flushed: true }); }; }
  flush() { if (!this.count) return; const data = new Float32Array(this.count); let offset = 0; for (const part of this.parts) { data.set(part, offset); offset += part.length; } this.port.postMessage({ samples: data }, [data.buffer]); this.parts = []; this.count = 0; }
  process(inputs) { const channels = inputs[0]; if (channels?.length) { const mono = new Float32Array(channels[0].length); for (const channel of channels) for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length; this.parts.push(mono); this.count += mono.length; if (this.count >= 2048) this.flush(); } return true; }
} registerProcessor('reading-capture', ReadingCapture);`;

export class ReadingRecorder {
  constructor({ request, limit, onUpdate, onLimit, onInterruption, getStream = () => navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false }) }) {
    Object.assign(this, { request, limit, onUpdate, onLimit, onInterruption });
    this.getStream = getStream;
    this.controller = new AbortController(); this.chunks = []; this.samples = 0; this.transcripts = new LiveTranscript();
    this.state = { duration: 0, level: 0, transcript: '', provisional: true, live: 'connecting' };
  }
  emit(values) { Object.assign(this.state, values); if (!this.closed) this.onUpdate({ ...this.state }); }
  async start() {
    if (!window.isSecureContext) throw new Error('Microphone access needs HTTPS or localhost.');
    if (!navigator.mediaDevices?.getUserMedia || !(window.AudioContext || window.webkitAudioContext)) throw new Error('This browser does not support recording. Try a current version of Chrome or Safari.');
    try {
      this.stream = await this.getStream();
      if (this.closed) { this.stream.getTracks().forEach((t) => t.stop()); return; }
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContext();
      if (!this.audioContext.audioWorklet) throw new Error('This browser cannot capture audio for feedback. Try a current version of Chrome or Safari.');
      await this.audioContext.resume();
      const url = URL.createObjectURL(new Blob([processorCode], { type: 'text/javascript' }));
      try { await this.audioContext.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      if (this.closed) return;
      this.node = new AudioWorkletNode(this.audioContext, 'reading-capture');
      this.node.port.onmessage = ({ data }) => {
        if (data.flushed) { this.flushed?.(); return; }
        if (this.closed || !data.samples) return;
        const remaining = Math.max(0, this.limit * this.audioContext.sampleRate - this.samples);
        const samples = data.samples.subarray(0, remaining);
        if (samples.length) { this.chunks.push(samples); this.samples += samples.length; }
        const energy = samples.reduce((n, v) => n + v * v, 0);
        this.emit({ duration: this.samples / this.audioContext.sampleRate, level: Math.min(1, Math.sqrt(energy / Math.max(1, samples.length)) * 8) });
        if (!this.reachedLimit && this.samples >= this.limit * this.audioContext.sampleRate) { this.reachedLimit = true; this.onLimit(); }
      };
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      this.mute = this.audioContext.createGain(); this.mute.gain.value = 0;
      this.source.connect(this.node); this.node.connect(this.mute); this.mute.connect(this.audioContext.destination);
      this.audioContext.onstatechange = () => {
        if (!this.closed && !this.stopping && ['suspended', 'interrupted'].includes(this.audioContext.state)) this.onInterruption();
      };
      this.deadline = setTimeout(() => { if (!this.closed && !this.stopping && !this.reachedLimit) { this.reachedLimit = true; this.onLimit(); } }, this.limit * 1000);
      this.stream.getAudioTracks().forEach((track) => track.addEventListener('ended', () => { if (!this.closed && !this.stopping) this.onInterruption(); }));
      void this.startTranscription();
    } catch (error) {
      await this.close();
      if (error.name === 'NotAllowedError') throw new Error('Microphone permission was denied. Allow microphone access in your browser and try again.');
      if (error.name === 'NotFoundError') throw new Error('No microphone was found. Connect one and try again.');
      throw error;
    }
  }
  async startTranscription() {
    const timeout = setTimeout(() => { this.controller.abort(); this.channel?.close(); this.peer?.close(); this.emit({ live: 'failed' }); }, 20000);
    try {
      if (!window.RTCPeerConnection) throw new Error();
      const { value } = await this.request('read-aloud/transcription-session', { method: 'POST', body: {}, signal: this.controller.signal });
      if (this.closed || this.stopping) return;
      this.peer = new RTCPeerConnection();
      this.peer.addTrack(this.stream.getAudioTracks()[0], this.stream);
      this.channel = this.peer.createDataChannel('oai-events');
      this.channel.onmessage = ({ data }) => {
        try {
          const event = JSON.parse(data);
          if (event.type === 'error' || event.type?.endsWith('transcription.failed')) { this.emit({ live: 'failed' }); return; }
          const transcript = this.transcripts.receive(event);
          this.emit({ transcript: transcript.text, provisional: transcript.provisional });
        } catch { this.emit({ live: 'failed' }); }
      };
      this.channel.onopen = () => {
        this.lastCommitSample = this.samples;
        this.commitTimer = setInterval(() => this.commitTranscription(), 10000);
        this.emit({ live: 'connected' });
      };
      this.channel.onclose = () => { if (!this.stopping) this.emit({ live: 'failed' }); };
      this.peer.onconnectionstatechange = () => { if (['failed', 'disconnected'].includes(this.peer?.connectionState)) this.emit({ live: 'failed' }); };
      await this.peer.setLocalDescription(await this.peer.createOffer());
      const response = await fetch('https://api.openai.com/v1/realtime/calls', { method: 'POST', body: this.peer.localDescription.sdp,
        headers: { Authorization: `Bearer ${value}`, 'Content-Type': 'application/sdp' }, signal: this.controller.signal });
      if (!response.ok) throw new Error();
      const sdp = await response.text();
      if (!this.closed && !this.stopping) await this.peer.setRemoteDescription({ type: 'answer', sdp });
    } catch { this.channel?.close(); this.peer?.close(); if (!this.closed && !this.stopping) this.emit({ live: 'failed' }); }
    finally { clearTimeout(timeout); }
  }
  async stop() {
    if (this.closed || this.stopping) return null;
    this.stopping = true;
    if (this.node) await new Promise((resolve) => { this.flushed = resolve; this.node.port.postMessage('flush'); setTimeout(resolve, 150); });
    this.commitTranscription();
    const bytes = encodeWav(this.chunks, this.audioContext?.sampleRate || 24000);
    await this.close(); return bytes;
  }
  async close() {
    this.closed = true; clearTimeout(this.deadline); clearInterval(this.commitTimer); this.controller.abort(); this.channel?.close(); this.peer?.close();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.source?.disconnect(); this.node?.disconnect(); this.mute?.disconnect();
    if (this.audioContext?.state !== 'closed') await this.audioContext?.close().catch(() => {});
    this.chunks = [];
  }
  commitTranscription() {
    if (this.channel?.readyState !== 'open' || this.samples - (this.lastCommitSample || 0) < (this.audioContext?.sampleRate || 24000) * .2) return;
    this.channel.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    this.lastCommitSample = this.samples;
  }
}

export async function submitAudioReview(body, bytes, signal) {
  const metadata = new TextEncoder().encode(JSON.stringify(body));
  const packet = new Uint8Array(4 + metadata.length + bytes.length);
  new DataView(packet.buffer).setUint32(0, metadata.length, true); packet.set(metadata, 4); packet.set(bytes, metadata.length + 4);
  const response = await fetch('/api/reading/read-aloud/review', { method: 'POST', credentials: 'include', signal,
    headers: { 'Content-Type': 'application/octet-stream' }, body: packet });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not review this recording. Please retry.');
  return data;
}
