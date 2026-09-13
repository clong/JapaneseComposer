import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TUTOR_AVATARS, VISEMES, TutorArticulation, TutorMotionDirector, captionGesture, resolveAvatarMotion } from '../src/tutor-avatar-model.js';
import { normalizePreferences } from './tutor-v2-server.js';

test('legacy account preferences receive avatar defaults without changing the voice', () => {
  const old = normalizePreferences({ voice: 'cedar', mode: 'guided' });
  assert.equal(old.avatarId, 'pikachu'); assert.equal(old.avatarMotion, 'auto'); assert.equal(old.voice, 'cedar');
  for (const avatar of TUTOR_AVATARS) for (const motion of ['auto', 'reduced', 'off']) {
    const prefs = normalizePreferences({ ...old, avatarId: avatar.id, avatarMotion: motion });
    assert.equal(prefs.avatarId, avatar.id); assert.equal(prefs.avatarMotion, motion); assert.equal(prefs.voice, 'cedar');
  }
  for (const legacyId of ['haru', 'aoi', 'ren', 'mika', '../../outside']) {
    const prefs = normalizePreferences({ avatarId: legacyId, avatarMotion: 'reduced', voice: 'cedar', mode: 'guided' });
    assert.equal(prefs.avatarId, 'pikachu'); assert.equal(prefs.avatarMotion, 'reduced');
    assert.equal(prefs.voice, 'cedar'); assert.equal(prefs.mode, 'guided');
  }
  assert.equal(normalizePreferences({ avatarMotion: 'invalid' }).avatarMotion, 'auto');
});

test('motion preferences respect the system setting and explicit still portraits', () => {
  assert.equal(resolveAvatarMotion('auto', true), 'reduced');
  assert.equal(resolveAvatarMotion('off', true), 'off');
  assert.equal(resolveAvatarMotion('reduced', false), 'reduced');
});

test('articulation closes on silence, interrupted playback, and stalled analysis', () => {
  const face = new TutorArticulation();
  face.set('viseme_aa', .7, 100);
  assert.equal(face.sample(120, true).viseme_aa, .7);
  assert.equal(face.sample(120, false).viseme_aa, 0);
  assert.equal(face.sample(300, true).viseme_aa, 0);
  face.set('viseme_aa', NaN, 310); assert.equal(face.sample(320, true).viseme_aa, 0);
  face.set('viseme_O', .8, 350); face.reset();
  assert.ok(Object.values(face.sample(351, true)).every((v) => v === 0));
});

test('caption cues never animate without audible speech and expired cues are discarded', () => {
  const director = new TutorMotionDirector();
  director.cue(captionGesture('こんにちは。'), 100);
  assert.equal(director.take(200, false, 'auto'), null);
  assert.equal(director.take(300, true, 'auto'), 'greeting');
  director.cue('explain', 400); assert.equal(director.take(1200, true, 'auto'), null);
  director.reset(); director.cue('success', 0); assert.equal(director.take(1, true, 'auto'), null);
  director.cue('success', 1, { confirmed: true }); assert.equal(director.take(2, true, 'auto'), 'success');
  director.reset(); director.cue('invite', 0); assert.equal(director.take(1, true, 'reduced'), null);
  director.reset(); director.cue('greeting', 0); director.reset(); assert.equal(director.take(1, true, 'auto'), null);
  assert.equal(captionGesture('incorrect'), null); assert.equal(captionGesture('For example, this phrase…'), 'explain');
});

test('HeadAudio preserves zero-valued /aa/ predictions and rejects invalid IDs', async () => {
  const previous = globalThis.AudioWorkletNode;
  globalThis.AudioWorkletNode = class { constructor() { this.port = { postMessage() {} }; } };
  try {
    const { HeadAudio } = await import('../src/vendor/headaudio/headaudio.mjs');
    const head = new HeadAudio({}); let aa = 0;
    head.onvalue = (name, value) => { if (name === 'viseme_aa') aa = value; };
    head._onmessage({ data: { event: 'viseme', viseme: 0 } }); head.update(100);
    assert.equal(head.visemeActive, 0); assert.ok(aa > .6);
    for (const viseme of [null, undefined, -2, 15, '0', NaN]) head._onmessage({ data: { event: 'viseme', viseme } });
    assert.equal(head.visemeActive, 0);
    head._onmessage({ data: { event: 'viseme', viseme: 14 } }); head.update(100); assert.ok(aa < 1e-6);
  } finally { globalThis.AudioWorkletNode = previous; }
});

test('the bundled Pikachu has its character pivots, speech shapes, and portrait assets', async () => {
  assert.deepEqual(TUTOR_AVATARS.map((avatar) => avatar.id), ['pikachu']);
  const avatar = TUTOR_AVATARS[0];
  const bytes = await readFile(new URL('../src/assets/tutor/pikachu.glb', import.meta.url));
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  for (const meshName of ['Mouth', 'Tongue', 'Head']) {
    const mesh = gltf.meshes.find((item) => item.name === meshName);
    assert.ok(mesh, `Pikachu is missing ${meshName}`);
    const targets = new Set(mesh.extras?.targetNames || []);
    for (const viseme of VISEMES) assert.ok(targets.has(`viseme_${viseme}`), `${meshName}: missing ${viseme}`);
  }
  const nodes = new Set(gltf.nodes.map((node) => node.name));
  for (const name of ['BodyPivot', 'HeadPivot', 'EarLeft', 'EarRight', 'ArmLeft', 'ArmRight', 'TailPivot', 'EyeLeft', 'EyeRight']) {
    assert.ok(nodes.has(name), `Pikachu is missing its ${name} animation pivot`);
  }
  assert.ok(bytes.length < 8 * 1024 * 1024, 'The local character should fit the mobile download budget');
  for (const suffix of ['.webp', '-thumb.webp']) {
    assert.ok((await readFile(new URL(`../src/assets/tutor/${avatar.id}${suffix}`, import.meta.url))).length > 1000);
  }
  const preview = await readFile(new URL('../src/assets/tutor/preview-ja.wav', import.meta.url));
  assert.equal(preview.toString('ascii', 0, 4), 'RIFF');
  assert.ok(preview.length > 1000);
});

test('audio failure fallback uses one audible path and disconnects all nodes on interruption', async () => {
  const { createTutorAvatarAudio } = await import('../src/tutor-avatar-audio.js');
  const original = globalThis.AudioContext;
  const nodes = []; let closed = false;
  class Node { constructor() { this.connections=[];nodes.push(this); } connect(other) { this.connections.push(other); } disconnect() { this.connections=[]; } }
  globalThis.AudioContext = class {
    constructor() { this.state='running';this.currentTime=0;this.destination={speaker:true}; }
    resume() { return Promise.resolve(); }
    createMediaStreamSource() { return new Node(); }
    createDelay() { const n=new Node();n.delayTime={value:0};return n; }
    createGain() { return new Node(); }
    createAnalyser() { const n=new Node();n.getFloatTimeDomainData=s=>s.fill(.02);return n; }
    close() { closed=true;this.state='closed';return Promise.resolve(); }
  };
  const element={muted:false,srcObject:null,pause(){},play(){return Promise.resolve()}};
  const audio=createTutorAvatarAudio({audioElement:element});
  try {
    await audio.attachStream({});
    assert.equal(audio.state.mode,'portrait'); assert.equal(element.muted,true);
    assert.equal(nodes.flatMap(n=>n.connections).filter(n=>n.speaker).length,1);
    await new Promise(r=>setTimeout(r,30)); assert.equal(audio.state.audible,true);
    audio.stop(); assert.equal(audio.state.active,false); assert.equal(element.srcObject,null);
    assert.ok(nodes.every(n=>n.connections.length===0));
    await audio.dispose(); assert.equal(closed,true);
  } finally { await audio.dispose();globalThis.AudioContext=original; }
});
