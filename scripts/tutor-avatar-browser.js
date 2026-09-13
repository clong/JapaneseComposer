// Local integration and visual checks. No microphone or model-service requests.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { parse, serializeOuter } from 'parse5';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
if (process.env.TUTOR_AVATAR_BROWSER && !['chrome', 'chromium'].includes(process.env.TUTOR_AVATAR_BROWSER)) {
  throw new Error('Tutor browser QA uses Google Chrome only.');
}
if ((process.env.TUTOR_AVATAR_CHANNEL && process.env.TUTOR_AVATAR_CHANNEL !== 'chrome') || process.env.TUTOR_AVATAR_EXECUTABLE) {
  throw new Error('Tutor browser QA launches installed Google Chrome; alternative channels and executables are disabled.');
}
const output = resolve(process.env.TUTOR_AVATAR_QA_DIR || '/tmp/jc-avatar-qa');
const temp = await mkdtemp(join(tmpdir(), 'jc-avatar-browser-'));
await mkdir(output, { recursive: true });
const document = parse(await readFile(join(root, 'dist/index.html'), 'utf8'));
function find(node, id) { if (node.attrs?.some((a) => a.name === 'id' && a.value === id)) return node; for (const child of node.childNodes || []) { const found = find(child, id); if (found) return found; } }
const shell = serializeOuter(find(document, 'tutor-avatar'));
await build({ entryPoints: [join(root, 'src/tutor-avatar.js')], outdir: temp, bundle: true, format: 'esm', splitting: true,
  chunkNames: '[name]-[hash]', alias: { 'three/addons/loaders/GLTFLoader.js': join(root, 'src/tutor-gltf-loader.js') } });
const html = `<!doctype html><html data-theme="light"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/app.css"><style>body{margin:0;padding:24px;background:#eef1eb}.fixture{max-width:390px;margin:auto;background:white;padding:18px;border-radius:20px}.fixture button{touch-action:manipulation}</style><div class="fixture">${shell}</div><audio id="audio"></audio><script type="module">
import {createTutorAvatar} from '/check/tutor-avatar.js';
window.settings={avatarId:'pikachu',avatarMotion:'auto',active:true,language:'en',status:'idle'};
window.avatar=createTutorAvatar({root:document.getElementById('tutor-avatar'),audioElement:document.getElementById('audio'),onPreferenceChange(p){Object.assign(settings,p)}});
avatar.update(settings);
window.update=(p)=>{Object.assign(settings,p);avatar.update(settings)};
</script></html>`;
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.wav': 'audio/wav', '.json': 'application/json' };
let failWorklet = false;
let stallCharacter = false, onStalledCharacter;
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('Cache-Control','no-store');
  if(failWorklet && pathname.endsWith('headworklet.mjs')) {res.writeHead(503);res.end();return;}
  if (stallCharacter && pathname.endsWith('/pikachu.glb')) {
    const closed = new Promise(resolve => res.once('close', () => resolve(!res.writableEnded)));
    onStalledCharacter?.({ closed });
    return;
  }
  if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
  const path = pathname.startsWith('/fixtures/') ? join(root, 'scripts/fixtures/tutor-avatar', pathname.slice('/fixtures/'.length))
    : pathname.startsWith('/check/vendor/') ? join(root, 'dist/assets', pathname.slice('/check/'.length))
    : pathname.startsWith('/check/') ? join(temp, pathname.slice('/check/'.length)) : join(root, 'dist', pathname);
  try { const bytes = await readFile(path); res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream'); res.end(bytes); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const name = 'chromium';
const results = { browser: name, checks: [], characters: [], errors: [] };
let browser;
const check = (name, detail) => { results.checks.push({ name, detail, passed: true }); console.log('PASS', name); };
try {
  browser = await chromium.launch({ headless: !process.env.TUTOR_AVATAR_HEADED,
    channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  results.version = browser.version();
  const context = await browser.newContext({ viewport: { width: 900, height: 1040 }, deviceScaleFactor: 1 });
  // Routine QA does not depend on the Google font CDN.
  await context.route(/https:\/\/fonts\./, (route) => route.abort());
  context.on('page', page => page.on('pageerror', error => results.errors.push(error.message)));
  const page = await context.newPage();
  await page.goto(url);
  const waitAvatar = (id) => page.waitForFunction((id) => avatar.diagnostics.rendererId === id || avatar.diagnostics.error, id);
  await waitAvatar('pikachu');
  const first = await page.evaluate(() => avatar.diagnostics);
  if (first.error) throw new Error(first.error);

  async function recordCharacter(id, size) {
    await page.evaluate(async () => {
      avatar.stopAudio(); update({ activityState:null, latestAssessment:null });
      await avatar.prepareAudio();
      const stage=document.querySelector('[data-avatar-stage]').getBoundingClientRect();
      const canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = Math.round(720*stage.height/stage.width);
      const ctx = canvas.getContext('2d'); const chunks = []; let frame;
      function draw() {
        const gradient = ctx.createRadialGradient(330,200,20,360,400,700); gradient.addColorStop(0,'#fffef7');gradient.addColorStop(.55,'#f9f0d2');gradient.addColorStop(1,'#e9d9ac');
        ctx.fillStyle=gradient;ctx.fillRect(0,0,canvas.width,canvas.height);
        const source=avatar.captureFrame();
        if(source)ctx.drawImage(source,0,0,canvas.width,canvas.height);
        ctx.font='24px sans-serif';ctx.fillStyle='#6d5e3b';ctx.fillText(document.querySelector('[data-avatar-name]').textContent,28,canvas.height-30);
        frame=requestAnimationFrame(draw);
      }
      draw();
      const stream=canvas.captureStream(30);avatar.captureAudio().getAudioTracks().forEach(t=>stream.addTrack(t));
      const mime=['video/webm;codecs=vp8,opus','video/mp4','video/webm'].find(t=>MediaRecorder.isTypeSupported(t));
      const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:2500000});
      recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
      window.recordingDone=new Promise(resolve=>{recorder.onstop=async()=>{cancelAnimationFrame(frame);stream.getVideoTracks().forEach(t=>t.stop());const blob=new Blob(chunks,{type:recorder.mimeType});const reader=new FileReader();reader.onload=()=>resolve({data:reader.result.slice(reader.result.indexOf('base64,')+7),mime:recorder.mimeType});reader.readAsDataURL(blob)}});
      window.recorder=recorder;recorder.start();
    });
    await page.evaluate(() => update({ status:'listening' })); await page.waitForTimeout(700);
    await page.evaluate(() => update({ status:'thinking' })); await page.waitForTimeout(600);
    await page.evaluate(() => { void avatar.previewAudio('/fixtures/marin-evaluation.wav'); });
    await page.waitForFunction(() => avatar.diagnostics.audio.audible, null, { timeout: 12000 });
    await page.evaluate(() => {
      const start=performance.now();let explained=false,acknowledged=false;
      window.motionFrames=[];window.motionSampler=setInterval(()=>{
        const d=avatar.diagnostics,at=performance.now();motionFrames.push({at,audible:d.audio.audible,level:d.audio.level,weights:d.weights,rendered:d.rendered});
        if(d.audio.audible && at-start>5200 && !explained){explained=true;avatar.caption({event_id:'explanation-'+at,delta:'例えば、'})}
        if(d.audio.audible && at-start>10500 && !acknowledged){acknowledged=true;update({latestAssessment:{id:'success-'+at,taskCompleted:true}})}
      },20);
      avatar.caption({event_id:'greeting-'+performance.now(),delta:'こんにちは。'});
    });
    await page.waitForTimeout(1500);
    await page.screenshot({path:join(output,`${name}-${id}-${size}-speaking.png`)});
    await page.waitForFunction(() => avatar.diagnostics.audio.kind === null, null, { timeout: 30000 });
    await page.evaluate(()=>{clearInterval(motionSampler);update({activityState:{status:'completed'}})});
    await page.waitForTimeout(400);
    await page.evaluate(()=>recorder.stop());
    const clip=await page.evaluate(()=>recordingDone);
    const file=`${name}-${id}-${size}.${clip.mime.includes('mp4')?'mp4':'webm'}`;
    assert.ok(clip.data.length>10000, 'Recorded clip contains no usable media');
    await writeFile(join(output,file),Buffer.from(clip.data,'base64'));
    const frames=await page.evaluate(()=>motionFrames);
    await writeFile(join(output,`${name}-${id}-${size}-motion.json`),JSON.stringify(frames));
    assert.ok(frames.some(f=>Object.values(f.weights).some(v=>v>.1)),'No audio-derived mouth shapes');
    results.characters.push({id,size,recording:file,frames:frames.length});
    console.log('RECORDED',id,size);
  }

  for (const id of ['pikachu']) {
    await page.waitForTimeout(600);
    await page.locator('[data-avatar-stage]').screenshot({ path:join(output,`${name}-${id}.png`) });
    if (process.env.TUTOR_AVATAR_PORTRAITS) {
      // Canvas only: no baked status label or theme background in a fallback portrait.
      const transparent = await page.addStyleTag({content:'html,body,.fixture,.tutor-avatar-scene{background:transparent!important}.tutor-avatar-scene::before,.tutor-avatar-presence,.tutor-avatar-ground,.tutor-avatar-poster{visibility:hidden!important}'});
      const bytes=await page.locator('.tutor-avatar-canvas:not(.is-loading) canvas').screenshot({omitBackground:true});
      await transparent.evaluate(e=>e.remove());
      await sharp(bytes).webp({quality:90}).toFile(join(root,`src/assets/tutor/${id}.webp`));
      // Preserve the complete silhouette, including both long ears and the tail.
      await sharp(bytes).resize(160,160,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).webp({quality:90}).toFile(join(root,`src/assets/tutor/${id}-thumb.webp`));
    }
    if (process.env.TUTOR_AVATAR_RECORD) await recordCharacter(id,'desktop');
  }
  assert.equal(await page.locator('[data-avatar-name]').textContent(), 'Pikachu');
  assert.equal(await page.locator('[data-avatar-id]').count(), 0);
  assert.equal(await page.locator('.tutor-avatar-canvas').count(), 1);
  check('the single Pikachu character loads without the retired character picker');
  await page.evaluate(()=>{avatar.caption({event_id:'caption-only',delta:'こんにちは。'});update({status:'speaking',activityState:null})});
  await page.waitForTimeout(300);
  assert.ok(Object.values((await page.evaluate(()=>avatar.diagnostics)).weights).every(v=>v===0));
  check('captions alone do not move the mouth');
  await page.locator('[data-avatar-preview]').click();
  await page.waitForFunction(()=>avatar.diagnostics.audio.audible);
  const clock=await page.evaluate(()=>avatar.diagnostics.audio.playbackTime);
  for (const avatarId of ['haru', 'aoi', 'ren', 'mika', 'unknown']) {
    await page.evaluate(avatarId => update({ avatarId }), avatarId);
    const state = await page.evaluate(() => avatar.diagnostics);
    assert.equal(state.avatarId, 'pikachu');
    assert.equal(state.rendererId, 'pikachu');
  }
  assert.equal((await page.evaluate(()=>avatar.diagnostics)).audio.kind,'preview');
  assert.ok((await page.evaluate(()=>avatar.diagnostics)).audio.playbackTime>=clock);
  assert.equal(await page.locator('.tutor-avatar-canvas').count(), 1);
  check('retired appearance preferences normalize to Pikachu without restarting playback');
  await page.emulateMedia({ reducedMotion:'reduce' });
  await page.waitForFunction(()=>avatar.diagnostics.motion==='reduced');
  assert.equal((await page.evaluate(()=>avatar.diagnostics)).motion,'reduced');
  await page.waitForTimeout(250);
  assert.equal((await page.evaluate(()=>avatar.diagnostics)).audio.kind,'preview');
  check('reduced motion retains audio');
  await page.locator('[data-avatar-motion]').selectOption('off');
  assert.equal(await page.locator('#tutor-avatar').evaluate(e=>e.classList.contains('has-avatar-renderer')),false);
  await page.locator('[data-avatar-motion]').selectOption('auto'); await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>avatar.stopAudio());
  assert.ok(Object.values((await page.evaluate(()=>avatar.diagnostics)).weights).every(v=>v===0));
  check('interruption clears articulation');
  await page.evaluate(()=>update({active:false}));
  assert.equal(await page.locator('#tutor-avatar').evaluate(e=>e.classList.contains('has-avatar-renderer')),false);
  await page.evaluate(()=>update({active:true})); check('hidden panel pauses and resumes rendering');
  await page.route('**/pikachu.glb', r => r.abort());
  await page.reload();
  await page.waitForFunction(()=>Boolean(avatar.diagnostics.error));
  assert.equal(await page.locator('[data-avatar-retry]').isVisible(),true);
  assert.equal(await page.locator('[data-avatar-portrait]').evaluate(e=>e.complete&&e.naturalWidth>0),true);
  await page.locator('[data-avatar-preview]').click();
  await page.waitForFunction(() => avatar.diagnostics.audio.audible);
  const failedModelClock = await page.evaluate(() => avatar.diagnostics.audio.playbackTime);
  await page.unroute('**/pikachu.glb'); await page.locator('[data-avatar-retry]').click(); await waitAvatar('pikachu');
  assert.equal((await page.evaluate(() => avatar.diagnostics)).audio.kind, 'preview');
  assert.ok((await page.evaluate(() => avatar.diagnostics)).audio.playbackTime >= failedModelClock);
  check('failed character download retains portrait and audio, and retry preserves playback');
  await page.evaluate(() => avatar.stopAudio());
  await page.evaluate(()=>{const canvas=document.querySelector('.tutor-avatar-canvas canvas');canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()});
  await page.waitForFunction(()=>Boolean(avatar.diagnostics.error));
  await page.locator('[data-avatar-retry]').click(); await waitAvatar('pikachu');
  check('WebGL loss recovers through portrait and retry');
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.screenshot({path:join(output,`${name}-dark.png`)});
  await page.evaluate(()=>document.documentElement.dataset.theme='light');
  await page.screenshot({path:join(output,`${name}-desktop.png`)});
  await page.setViewportSize({width:390,height:844});
  if(process.env.TUTOR_AVATAR_RECORD) await recordCharacter('pikachu','mobile');
  await page.screenshot({path:join(output,`${name}-mobile.png`)});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  check('mobile layout has no horizontal overflow');
  if(process.env.TUTOR_AVATAR_SPEECH) {
    const voices=['marin','cedar','alloy','ash','ballad','coral','echo','sage','shimmer','verse'];
    const trials=[...voices.map(voice=>({voice,rate:1})),{voice:'marin',rate:.8},{voice:'marin',rate:1.2}];
    results.speech=[];
    for(const trial of trials) {
      await page.evaluate(({voice,rate})=>{
        window.speechFrames=[];window.speechSampler=setInterval(()=>{const d=avatar.diagnostics;speechFrames.push({at:performance.now(),audible:d.audio.audible,level:d.audio.level,rendered:d.rendered,fps:d.stats?.fps})},10);
        void avatar.previewAudio(`/fixtures/${voice}-evaluation.wav`,{rate});
      },trial);
      await page.waitForFunction(()=>avatar.diagnostics.audio.audible);
      await page.waitForFunction(()=>avatar.diagnostics.audio.kind===null,null,{timeout:30000});
      const frames=await page.evaluate(()=>{clearInterval(speechSampler);return speechFrames});
      const starts=[],closes=[];
      for(let i=1;i<frames.length;i++) {
        const f=frames[i],prev=frames[i-1];
        if(f.audible&&!prev.audible){const end=frames.findIndex((g,j)=>j>i&&!g.audible);const burst=frames.slice(i,end<0?undefined:end);if(burst.at(-1).at-f.at>=100){const onset=burst.find(g=>Object.values(g.rendered||{}).some(v=>v>.03));starts.push(onset?onset.at-f.at:Infinity)}}
        if(!f.audible&&prev.audible){const end=frames.findIndex((g,j)=>j>i&&g.audible);const gap=frames.slice(i,end<0?undefined:end);if(gap.at(-1).at-f.at>=150){const closed=gap.find(g=>Object.values(g.rendered||{}).every(v=>v<.03));closes.push(closed?closed.at-f.at:Infinity)}}
      }
      const summary={...trial,onsetMax:Math.max(...starts),closureMax:Math.max(...closes),speechBursts:starts.length,fps:frames.map(f=>f.fps).filter(Boolean).sort((a,b)=>a-b)[Math.floor(frames.length/2)]};
      results.speech.push(summary);console.log('SPEECH',summary);
      await writeFile(join(output,`${name}-${trial.voice}-${trial.rate}-timing.json`),JSON.stringify(frames));
      assert.ok(starts.length && closes.length, `${trial.voice} fixture must contain speech and sustained silence`);
      assert.ok(summary.onsetMax<=100,`${trial.voice} mouth onset exceeded 100 ms`);
      assert.ok(summary.closureMax<=150,`${trial.voice} mouth closure exceeded 150 ms`);
    }
    check('ten voices, Japanese vowel and pause fixtures, slow and fast delivery');
  }
  await page.evaluate(()=>avatar.dispose());
  assert.equal(await page.locator('.tutor-avatar-canvas').count(),0);
  check('disposal releases character nodes and audio context');
  if(!process.env.TUTOR_AVATAR_RECORD) {
    async function within(promise, message, ms = 10000) {
      let timer;
      try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]); }
      finally { clearTimeout(timer); }
    }
    const abortedWithin = request => within(request.closed, 'The pending character download was not aborted.', 1500);
    stallCharacter = true;
    const lostDuringLoad = await context.newPage();
    const lostRequest = new Promise(resolve => { onStalledCharacter = resolve; });
    await lostDuringLoad.goto(url, { waitUntil: 'domcontentloaded' });
    const stalledForLoss = await within(lostRequest, 'The initial character download did not start.');
    await lostDuringLoad.locator('.tutor-avatar-canvas canvas').waitFor();
    await lostDuringLoad.evaluate(() => document.querySelector('.tutor-avatar-canvas canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
    await lostDuringLoad.waitForFunction(() => Boolean(avatar.diagnostics.error));
    assert.equal(await lostDuringLoad.locator('[data-avatar-portrait]').evaluate(e => e.complete && e.naturalWidth > 0), true);
    assert.equal(await lostDuringLoad.locator('[data-avatar-retry]').isVisible(), true);
    assert.equal(await lostDuringLoad.locator('.tutor-avatar-canvas').count(), 0);
    assert.equal(await abortedWithin(stalledForLoss), true);
    stallCharacter = false;
    await lostDuringLoad.locator('[data-avatar-retry]').click();
    await lostDuringLoad.waitForFunction(() => avatar.diagnostics.rendererId === 'pikachu' && !avatar.diagnostics.error);
    assert.equal(await lostDuringLoad.locator('.tutor-avatar-canvas').count(), 1);
    await lostDuringLoad.evaluate(() => avatar.dispose()); await lostDuringLoad.close();
    check('WebGL loss during the initial download aborts loading and recovers from the portrait');

    stallCharacter = true;
    const disposeDuringLoad = await context.newPage();
    await disposeDuringLoad.addInitScript(() => {
      window.fixtureObservers = 0;
      for (const type of ['ResizeObserver', 'MutationObserver']) {
        const Base = window[type];
        window[type] = class extends Base {
          observe(...args) { if (!this.fixtureActive) { this.fixtureActive = true; window.fixtureObservers++; } return super.observe(...args); }
          disconnect() { if (this.fixtureActive) { this.fixtureActive = false; window.fixtureObservers--; } super.disconnect(); }
        };
      }
    });
    const disposalRequest = new Promise(resolve => { onStalledCharacter = resolve; });
    await disposeDuringLoad.goto(url, { waitUntil: 'domcontentloaded' });
    const stalledForDisposal = await within(disposalRequest, 'The initial character download did not start.');
    await disposeDuringLoad.locator('.tutor-avatar-canvas canvas').waitFor();
    assert.ok(await disposeDuringLoad.evaluate(() => fixtureObservers >= 2));
    const disposed = await disposeDuringLoad.evaluate(async () => {
      await avatar.dispose();
      return { canvases: document.querySelectorAll('.tutor-avatar-canvas').length, observers: fixtureObservers };
    });
    assert.deepEqual(disposed, { canvases: 0, observers: 0 });
    assert.equal(await abortedWithin(stalledForDisposal), true);
    stallCharacter = false; onStalledCharacter = undefined;
    await disposeDuringLoad.close();
    check('disposal during the initial download immediately releases canvases, observers, and the request');

    failWorklet=true;
    await page.reload();await waitAvatar('pikachu');await page.locator('[data-avatar-preview]').click();
    await page.waitForFunction(()=>avatar.diagnostics.audio.mode==='portrait'&&avatar.diagnostics.audio.audible);
    const beforeRetry=await page.evaluate(()=>avatar.diagnostics.audio.playbackTime);
    failWorklet=false;await page.locator('[data-avatar-retry]').click();
    await page.waitForFunction(()=>avatar.diagnostics.audio.mode==='visemes');
    assert.ok((await page.evaluate(()=>avatar.diagnostics.audio.playbackTime))>beforeRetry);
    check('worklet failure preserves audio and retry attaches analysis without restart');
    await page.evaluate(async()=>{
      avatar.stopAudio();await avatar.prepareAudio();
      window.fixtureContext=new AudioContext();await fixtureContext.resume();
      const buffer=await fixtureContext.decodeAudioData(await(await fetch('/assets/tutor/preview-ja.wav')).arrayBuffer());
      window.fixtureSource=fixtureContext.createBufferSource();fixtureSource.buffer=buffer;fixtureSource.loop=true;
      const output=fixtureContext.createMediaStreamDestination();fixtureSource.connect(output);
      await avatar.attachAudio(output.stream);fixtureSource.start();
      window.fixtureHidden=false;Object.defineProperty(document,'hidden',{configurable:true,get:()=>fixtureHidden});
    });
    await page.waitForFunction(()=>avatar.diagnostics.audio.audible);
    await page.evaluate(()=>{fixtureHidden=true;document.dispatchEvent(new Event('visibilitychange'))});
    await page.waitForTimeout(300);
    assert.equal((await page.evaluate(()=>avatar.diagnostics)).stats.running,false);
    assert.equal((await page.evaluate(()=>avatar.diagnostics)).audio.active,true);
    await page.evaluate(()=>{fixtureHidden=false;document.dispatchEvent(new Event('visibilitychange'))});
    await page.waitForFunction(()=>avatar.diagnostics.stats.running);
    check('background/resume keeps the conversation stream connected');
    await page.evaluate(async()=>{await avatar.dispose();fixtureSource.stop();await fixtureContext.close()});
    const fallback=await context.newPage();
    await fallback.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/.test(type)?null:get.call(this,type,...args)}});
    await fallback.goto(url);await fallback.waitForFunction(()=>Boolean(avatar.diagnostics.error));
    assert.equal(await fallback.locator('[data-avatar-portrait]').evaluate(e=>e.complete&&e.naturalWidth>0),true);
    await fallback.locator('[data-avatar-preview]').click();await fallback.waitForFunction(()=>avatar.diagnostics.audio.audible);
    check('no WebGL still allows preview audio with a visible portrait');
    await fallback.evaluate(()=>avatar.dispose());await fallback.close();
    const autoplay=await context.newPage();
    await autoplay.addInitScript(()=>{
      const Base=window.AudioContext;window.allowFixtureAudio=false;
      window.AudioContext=class extends Base {
        constructor(...args){super(...args);void this.suspend()}
        resume(){return window.allowFixtureAudio?super.resume():new Promise(()=>{})}
      };
    });
    await autoplay.goto(url);await autoplay.waitForFunction(()=>Boolean(avatar.diagnostics.rendererId));
    await autoplay.locator('[data-avatar-preview]').click();
    await autoplay.waitForFunction(()=>avatar.diagnostics.audio.blocked);
    assert.equal(await autoplay.locator('[data-avatar-enable-audio]').isVisible(),true);
    await autoplay.evaluate(()=>window.allowFixtureAudio=true);
    await autoplay.locator('[data-avatar-enable-audio]').click();
    await autoplay.waitForFunction(()=>avatar.diagnostics.audio.audible&&!avatar.diagnostics.audio.blocked);
    check('blocked autoplay recovers from the explicit enable-audio action');
    await autoplay.evaluate(()=>avatar.dispose());await autoplay.close();
  }
  if(results.errors.length)throw new Error(results.errors.join('\n'));
  await context.close();
} catch(error) {
  results.errors.push(error.stack || error.message); throw error;
} finally {
  await writeFile(join(output,`${name}-results.json`),JSON.stringify(results,null,2));
  await browser?.close();server.close();await rm(temp,{recursive:true,force:true});
}
