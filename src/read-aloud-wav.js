export const WAV_RATE = 24000;
export function encodeWav(chunks, inputRate) {
  const length = chunks.reduce((n, chunk) => n + chunk.length, 0);
  const samples = new Float32Array(length); let offset = 0;
  for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
  const count = Math.floor(length * WAV_RATE / inputRate);
  const bytes = new Uint8Array(44 + count * 2), view = new DataView(bytes.buffer);
  const ascii = (at, s) => [...s].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
  ascii(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, WAV_RATE, true); view.setUint32(28, WAV_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) {
    const p = i * inputRate / WAV_RATE, left = Math.floor(p), fraction = p - left;
    const sample = Math.max(-1, Math.min(1, samples[left] * (1 - fraction) + (samples[left + 1] ?? samples[left]) * fraction));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}
export function inspectWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at, length) => String.fromCharCode(...bytes.slice(at, at + length));
  if (bytes.length < 44 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE' || ascii(12, 4) !== 'fmt '
    || view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1
    || view.getUint32(24, true) !== WAV_RATE || view.getUint16(34, true) !== 16 || ascii(36, 4) !== 'data'
    || view.getUint32(40, true) !== bytes.length - 44 || (bytes.length - 44) % 2) throw new Error('Use a mono 24 kHz PCM WAV recording.');
  const count = (bytes.length - 44) / 2;
  let sum = 0, peak = 0, silenceStart = null, voicedSeconds = 0;
  const pauses = [];
  for (let start = 0; start < count; start += 480) {
    let energy = 0; const end = Math.min(count, start + 480);
    for (let i = start; i < end; i++) { const s = view.getInt16(44 + i * 2, true) / 32768; energy += s * s; peak = Math.max(peak, Math.abs(s)); }
    sum += energy;
    if (Math.sqrt(energy / (end - start)) < .009) { if (silenceStart === null) silenceStart = start / WAV_RATE; }
    else {
      voicedSeconds += (end - start) / WAV_RATE;
      if (silenceStart !== null && start / WAV_RATE - silenceStart >= .5) pauses.push({ start: silenceStart, end: start / WAV_RATE });
      silenceStart = null;
    }
  }
  if (silenceStart !== null && count / WAV_RATE - silenceStart >= .5) pauses.push({ start: silenceStart, end: count / WAV_RATE });
  return { duration: count / WAV_RATE, rms: Math.sqrt(sum / Math.max(1, count)), peak, voicedSeconds, pauses: pauses.slice(0, 100) };
}
