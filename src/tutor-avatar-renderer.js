import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from './tutor-gltf-loader.js';
import { VISEMES } from './tutor-avatar-model.js';

const MOUTH_SHAPES = VISEMES.map((name) => `viseme_${name}`);
const clamp = THREE.MathUtils.clamp;
const ease = (value) => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };
const abortedLoad = () => new DOMException('Character loading was cancelled.', 'AbortError');

function disposeObjects(roots) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  for (const root of roots) root?.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const texture of textures) { texture.source?.data?.close?.(); texture.dispose(); }
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

// The character rig is independent of the conversation's audio graph. Opening
// or replacing this renderer cannot start or stop the audible playback path.
export async function createTutorAvatarRenderer(node, avatar, { sample = () => ({}), onError = () => {}, signal } = {}) {
  if (signal?.aborted) throw abortedLoad();
  let disposed = false, visible = true, motion = 'auto', expression = 'idle', frameId = null;
  let initializing = true, initializationError = null, rejectInitialization;
  const manager = new THREE.LoadingManager();
  const request = new AbortController();
  let lastFrame = 0, animationClock = 0, gesture = null, frameDuration = 0;
  let fps = 0, fpsCount = 0, fpsSince = performance.now(), measuredFrames = 0, slowFrames = 0;
  let nextBlink = 1.8 + Math.random() * 2.5, blinkStart = -10, nextGaze = 1.5;
  const gaze = new THREE.Vector2(), gazeTarget = new THREE.Vector2();
  const attention = new THREE.Vector3(), attentionTarget = new THREE.Vector3();
  const weights = Object.fromEntries(MOUTH_SHAPES.map((name) => [name, 0]));
  const rig = {}, rest = new Map(), morphs = [], armSides = { ArmLeft: 1, ArmRight: -1 };
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1.4, 1.4, 1.75, -1.75, .1, 30);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = .9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.addEventListener('webglcontextlost', lost);
  node.append(renderer.domElement);

  const hemisphere = new THREE.HemisphereLight(0xfff8ec, 0x88766b, .85);
  const key = new THREE.DirectionalLight(0xfff0d6, 2.7);
  key.position.set(-3.5, 5, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -2.5, right: 2.5, top: 3.2, bottom: -2.0, near: .1, far: 14 });
  key.shadow.bias = -.0006;
  key.shadow.normalBias = .035;
  key.shadow.radius = 4;
  const fill = new THREE.DirectionalLight(0xd8e8ff, .85);
  fill.position.set(3, 2, 4);
  const rim = new THREE.DirectionalLight(0xffe3a7, 1.8);
  rim.position.set(1.8, 3, -3);
  scene.add(hemisphere, key, fill, rim);

  const environmentScene = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(environmentScene, .06);
  scene.environment = environment.texture;
  scene.environmentIntensity = .4;
  environmentScene.dispose();
  pmrem.dispose();

  // A broad translucent contact shadow grounds the feet without a spotlight
  // edge. It has no DOM overlay and shares the character's camera.
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 128;
  const context = shadowCanvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 5, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(66,40,10,0.32)');
  gradient.addColorStop(.45, 'rgba(66,40,10,0.16)');
  gradient.addColorStop(1, 'rgba(66,40,10,0)');
  context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
  const contactTexture = new THREE.CanvasTexture(shadowCanvas);
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.25), new THREE.MeshBasicMaterial({ map: contactTexture, transparent: true, depthWrite: false, opacity: .85 }));
  contact.rotation.x = -Math.PI / 2; contact.position.set(0, -.004, .05);
  scene.add(contact);

  let bounds = new THREE.Box3(new THREE.Vector3(-1, 0, -.5), new THREE.Vector3(1, 2.45, .6));
  function resize() {
    if (disposed) return;
    const width = Math.max(1, node.clientWidth), height = Math.max(1, node.clientHeight), aspect = width / height;
    const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    // The extra space accommodates a waving paw and the ears' secondary motion.
    const frameHeight = Math.max(size.y * 1.24, size.x * 1.2 / aspect, 2.8);
    camera.left = -frameHeight * aspect / 2; camera.right = frameHeight * aspect / 2;
    camera.top = frameHeight / 2; camera.bottom = -frameHeight / 2;
    camera.position.set(center.x, center.y + .04, 7);
    camera.lookAt(center.x, center.y - .065, 0);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    if (visible) renderer.render(scene, camera);
  }
  function setTheme() {
    if (disposed) return;
    const dark = document.documentElement.dataset.theme === 'dark';
    hemisphere.intensity = dark ? .75 : .85;
    fill.intensity = dark ? .95 : .85;
    rim.intensity = dark ? 2.1 : 1.8;
    scene.environmentIntensity = dark ? .35 : .4;
    contact.material.opacity = dark ? .95 : .85;
    if (visible) renderer.render(scene, camera);
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(node);
  const themeObserver = new MutationObserver(setTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  function lost(event) {
    event.preventDefault();
    if (disposed) return;
    const error = new Error('The 3D display needs to be reloaded.');
    // The controller cannot report errors through a renderer that has not yet
    // committed. Reject its pending initialization instead of resolving a lost
    // WebGL canvas after the model eventually finishes downloading.
    if (initializing) { failInitialization(error); return; }
    pause();
    onError(error);
  }
  function failInitialization(error) {
    if (disposed || !initializing) return;
    initializationError = error;
    rejectInitialization?.(error);
    dispose();
  }
  function cancelled() { failInitialization(abortedLoad()); }
  function pause() {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null; lastFrame = 0;
  }
  function start() {
    if (disposed || !visible || frameId !== null) return;
    lastFrame = 0; fpsSince = performance.now(); fpsCount = 0;
    frameId = requestAnimationFrame(animate);
  }
  function restoreRig() {
    for (const [object, base] of rest) {
      object.position.copy(base.position); object.quaternion.copy(base.quaternion); object.scale.copy(base.scale);
    }
  }
  function rotate(name, x = 0, y = 0, z = 0) {
    const object = rig[name];
    if (!object) return;
    object.rotateX(x); object.rotateY(y); object.rotateZ(z);
  }
  function articulate(frame) {
    // HeadAudio already eases these weights. An additional tween would make the
    // visible articulation lag the single audible playback path.
    for (const name of MOUTH_SHAPES) weights[name] = frame.audible ? clamp(Number(frame.weights?.[name]) || 0, 0, 1) : 0;
    for (const mesh of morphs) {
      for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
        if (name in weights) mesh.morphTargetInfluences[index] = weights[name];
        // Smile cannot flatten rounded or closed-lip shapes during speech.
        else if (/^(Smile|smile|mouthSmile)$/.test(name)) mesh.morphTargetInfluences[index] = frame.audible || expression === 'correction' ? 0 : expression === 'completion' ? .3 : .08;
      }
    }
  }
  function pose(now, dt, audible) {
    restoreRig();
    if (now >= nextBlink) { blinkStart = now; nextBlink = now + 2.5 + Math.random() * 4.3; }
    const blinkTime = now - blinkStart;
    const blink = blinkTime >= 0 && blinkTime < .17 ? Math.sin(Math.PI * blinkTime / .17) ** .65 : 0;
    for (const name of ['EyeLeft', 'EyeRight']) if (rig[name]) rig[name].scale.y *= Math.max(.045, 1 - blink);
    if (motion !== 'auto') return;

    if (now > nextGaze) {
      // Long eye contact alternates with small, nonperiodic looks.
      const contact = Math.random() < (audible ? .86 : .68);
      gazeTarget.set(contact ? 0 : (Math.random() - .5) * .07, contact ? 0 : (Math.random() - .5) * .045);
      nextGaze = now + 1.8 + Math.random() * 3.2;
    }
    gaze.lerp(gazeTarget, 1 - Math.exp(-dt * 2.8));
    const breath = Math.sin(now * 1.72) * .006 + Math.sin(now * .79 + 1.4) * .002;
    if (rig.BodyPivot) { rig.BodyPivot.scale.y *= 1 + breath; rig.BodyPivot.scale.x *= 1 - breath * .4; }
    rotate('BodyPivot', 0, Math.sin(now * .48) * .008, Math.sin(now * .73) * .012);
    rotate('HeadPivot', gaze.y + Math.sin(now * 1.03 + 1) * .008, gaze.x, Math.sin(now * .66) * .014);
    rotate('EarLeft', Math.sin(now * 1.45 + .7) * .025, .012 * Math.sin(now * .83), .018 * Math.sin(now * .94));
    rotate('EarRight', Math.sin(now * 1.23 + 2) * .022, .012 * Math.sin(now * .91 + 1), .022 * Math.sin(now * .81 + .8));
    rotate('TailPivot', .015 * Math.sin(now * 1.6), Math.sin(now * 1.08) * .036, Math.sin(now * 1.32 + 1) * .024);
    attentionTarget.set(0, 0, 0);
    if (expression === 'listening' || expression === 'correction') attentionTarget.set(-.025, 0, expression === 'correction' ? -.035 : .026);
    if (expression === 'preparing') attentionTarget.set(-.02, .028, -.025);
    attention.lerp(attentionTarget, 1 - Math.exp(-dt * 4));
    rotate('HeadPivot', attention.x, attention.y, attention.z);

    if (!gesture) return;
    const elapsed = now - gesture.start, duration = gesture.duration;
    if (elapsed >= duration) { gesture = null; return; }
    const amount = ease(elapsed / .25) * (1 - ease((elapsed - duration + .35) / .35));
    if (gesture.kind === 'greeting') {
      rotate('ArmRight', -.13 * amount, -.18 * amount, armSides.ArmRight * .85 * amount);
      rotate('ArmRight', 0, 0, armSides.ArmRight * Math.sin(elapsed * 15) * .1 * amount);
      rotate('HeadPivot', 0, -.035 * amount, .045 * amount);
      rotate('EarRight', -.05 * amount, 0, -.035 * amount);
    } else if (gesture.kind === 'invite') {
      rotate('ArmLeft', -.4 * amount, -.12 * amount, armSides.ArmLeft * .22 * amount);
      rotate('HeadPivot', .03 * amount, .025 * amount, -.035 * amount);
    } else if (gesture.kind === 'explain') {
      rotate('ArmLeft', -.32 * amount, -.1 * amount, armSides.ArmLeft * .25 * amount);
      rotate('ArmRight', -.18 * amount, .08 * amount, armSides.ArmRight * .16 * amount);
      rotate('HeadPivot', Math.sin(elapsed * 4) * .025 * amount, .025 * amount, 0);
    } else if (gesture.kind === 'success') {
      const bounce = Math.sin(Math.PI * clamp(elapsed / .7, 0, 1));
      if (rig.BodyPivot) rig.BodyPivot.position.y += .045 * bounce;
      rotate('ArmLeft', -.12 * amount, 0, armSides.ArmLeft * .45 * amount);
      rotate('ArmRight', -.12 * amount, 0, armSides.ArmRight * .45 * amount);
      rotate('EarLeft', -.07 * amount, 0, -.04 * amount);
      rotate('EarRight', -.06 * amount, 0, .04 * amount);
      rotate('HeadPivot', .06 * Math.sin(elapsed * 5.4) * amount);
    } else if (gesture.kind === 'acknowledge') rotate('HeadPivot', .075 * Math.sin(elapsed * Math.PI / duration) * amount);
  }
  function animate(timestamp) {
    frameId = null;
    if (disposed || !visible) return;
    const deltaMs = lastFrame ? timestamp - lastFrame : 1000 / 60;
    if (deltaMs >= frameDuration - 1) {
      lastFrame = timestamp;
      const dt = Math.min(deltaMs / 1000, .05);
      animationClock += dt;
      const frame = sample() || {};
      articulate(frame); pose(animationClock, dt, Boolean(frame.audible));
      renderer.render(scene, camera);
      fpsCount++;
      if (timestamp - fpsSince >= 1000) { fps = Math.round(fpsCount * 1000 / (timestamp - fpsSince)); fpsSince = timestamp; fpsCount = 0; }
      measuredFrames++; if (deltaMs > 26) slowFrames++;
      if (measuredFrames >= 180) {
        if (slowFrames > 100 && renderer.getPixelRatio() > 1) renderer.setPixelRatio(1);
        else if (slowFrames > 100) frameDuration = 1000 / 30;
        measuredFrames = slowFrames = 0;
      }
    }
    frameId = requestAnimationFrame(animate);
  }
  function dispose() {
    if (disposed) return;
    disposed = true; pause(); gesture = null;
    signal?.removeEventListener('abort', cancelled);
    request.abort(); manager.abort();
    resizeObserver.disconnect(); themeObserver.disconnect();
    renderer.domElement.removeEventListener('webglcontextlost', lost);
    disposeObjects([scene]);
    environment.dispose(); key.shadow.dispose(); scene.clear();
    renderer.renderLists.dispose(); renderer.dispose(); renderer.forceContextLoss();
    node.remove();
  }

  try {
    const interrupted = new Promise((_, reject) => { rejectInitialization = reject; });
    signal?.addEventListener('abort', cancelled, { once: true });
    if (signal?.aborted) cancelled();
    // Fetch the self-contained GLB through this instance's signal. Three's
    // FileLoader deduplicates concurrent URL requests globally, so cancelling
    // an old request there can accidentally abort an immediate retry as well.
    // The dedicated manager still cancels any resources requested during parse.
    const modelURL = new URL(avatar.model, document.baseURI);
    const loading = fetch(modelURL, { signal: request.signal }).then(async (response) => {
      if (!response.ok) throw new Error(`Character download failed (${response.status}).`);
      const buffer = await response.arrayBuffer();
      if (disposed) throw initializationError || abortedLoad();
      return new GLTFLoader(manager).parseAsync(buffer, new URL('.', modelURL).href);
    }).then((gltf) => {
      // Decoder/image promises may finish even after transport cancellation.
      // Their resources never enter the disposed scene and still need release.
      if (disposed) { disposeObjects(gltf.scenes || [gltf.scene]); throw initializationError || abortedLoad(); }
      return gltf;
    });
    const gltf = await Promise.race([loading, interrupted]);
    if (disposed) { disposeObjects(gltf.scenes || [gltf.scene]); throw initializationError || abortedLoad(); }
    if (renderer.getContext().isContextLost()) { disposeObjects(gltf.scenes || [gltf.scene]); throw new Error('The 3D display needs to be reloaded.'); }
    const model = gltf.scene;
    scene.add(model);
    model.traverse((object) => {
      if (['BodyPivot', 'HeadPivot', 'EarLeft', 'EarRight', 'ArmLeft', 'ArmRight', 'TailPivot', 'EyeLeft', 'EyeRight'].includes(object.name)) {
        rig[object.name] = object;
        rest.set(object, { position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone() });
      }
      if (!object.isMesh) return;
      object.castShadow = true; object.receiveShadow = true;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        // Blender exports its white sheen color at full strength. Restore the
        // authored subtle velvet weight so warm yellow does not become cream.
        if (material?.name === 'Warm golden velvet') {
          material.sheen = .18; material.sheenColor.set(0xffdf80);
          material.sheenRoughness = .7; material.clearcoat = .035;
        }
      }
      if (object.morphTargetDictionary) morphs.push(object);
    });
    bounds = new THREE.Box3().setFromObject(model);
    const bodyCenter = rig.BodyPivot?.getWorldPosition(new THREE.Vector3()) || new THREE.Vector3();
    for (const name of ['ArmLeft', 'ArmRight']) if (rig[name]) armSides[name] = Math.sign(rig[name].getWorldPosition(new THREE.Vector3()).x - bodyCenter.x) || armSides[name];
    setTheme(); resize(); articulate({ audible: false }); pose(0, 0, false);
    renderer.render(scene, camera);
    if (renderer.getContext().isContextLost()) throw new Error('The 3D display needs to be reloaded.');
    initializing = false; rejectInitialization = null;
    signal?.removeEventListener('abort', cancelled);
    start();
  } catch (error) { dispose(); throw error; }

  return {
    dispose,
    setVisible(value) {
      if (disposed || visible === Boolean(value)) return;
      visible = Boolean(value); gesture = null; gaze.set(0, 0); gazeTarget.set(0, 0);
      if (visible) {
        nextBlink = animationClock + 1.2 + Math.random();
        const frame = sample() || {}; articulate(frame); pose(animationClock, 0, Boolean(frame.audible));
        resize(); start();
      }
      else pause();
    },
    setMotion(value) {
      if (disposed || motion === value) return;
      motion = value; gesture = null; gaze.set(0, 0); gazeTarget.set(0, 0); attention.set(0, 0, 0); restoreRig();
    },
    setState(value) { expression = value; },
    gesture(kind) {
      if (disposed || !visible || motion !== 'auto') return;
      const durations = { greeting: 1.65, invite: 1.35, explain: 1.6, success: 1.25, acknowledge: .8 };
      if (durations[kind]) gesture = { kind, start: animationClock, duration: durations[kind] };
    },
    reset() {
      if (disposed) return;
      gesture = null; articulate({ audible: false });
      // Clear an interrupted gesture even while a hidden tab has no next frame.
      restoreRig(); gaze.set(0, 0); gazeTarget.set(0, 0);
      if (!disposed && visible) renderer.render(scene, camera);
    },
    get articulation() { return { ...weights }; },
    captureFrame() { if (disposed) return null; renderer.render(scene, camera); return renderer.domElement; },
    get stats() { return { fps, running: !disposed && visible && frameId !== null, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries }; }
  };
}
