import { connectTutorV2Sdp } from './tutor-v2-api.js';
import { isTutorLiveModel } from './tutor-live.js';

function waitForIceGathering(peerConnection, timeoutMs = 10000) {
  if (peerConnection.iceGatheringState === 'complete') {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      peerConnection.removeEventListener('icegatheringstatechange', handleChange);
      if (error) reject(error);
      else resolve();
    };
    const handleChange = () => {
      if (peerConnection.iceGatheringState === 'complete') finish();
    };
    const timer = setTimeout(() => finish(new Error('Timed out gathering microphone connection candidates.')), timeoutMs);
    peerConnection.addEventListener('icegatheringstatechange', handleChange);
  });
}

export async function connectTutorV2WebRtc({
  sessionId,
  model,
  onEvent = () => {},
  onRemoteStream = () => {},
  onDataChannelOpen = () => {},
  onSessionStarted = () => {},
  onDataChannelClose = () => {},
  onConnectionState = () => {},
  mediaDevices = navigator.mediaDevices,
  PeerConnection = RTCPeerConnection,
  connectSdp = connectTutorV2Sdp,
  signal
} = {}) {
  if (!sessionId) throw new Error('Missing tutor session id');
  if (!mediaDevices?.getUserMedia) throw new Error('Microphone access is unavailable.');

  const micStream = await mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });
  const peerConnection = new PeerConnection();
  const dataChannel = peerConnection.createDataChannel('oai-events');
  let resolveStarted;
  let rejectStarted;
  let startupTimer;
  const started = new Promise((resolve, reject) => { resolveStarted = resolve; rejectStarted = reject; });
  // Register rejection handling while the HTTP exchange is still pending.
  void started.catch(() => {});

  peerConnection.addEventListener('track', (event) => {
    const stream = event.streams?.[0] || new MediaStream([event.track]);
    if (stream) onRemoteStream(stream);
  });
  peerConnection.addEventListener('connectionstatechange', () => {
    onConnectionState(peerConnection.connectionState);
  });
  micStream.getAudioTracks().forEach((track) => peerConnection.addTrack(track, micStream));

  dataChannel.addEventListener('message', (event) => {
    let parsed;
    try {
      parsed = JSON.parse(event.data);
    } catch (error) {
      return;
    }
    onEvent(parsed);
    if (parsed.type === 'session.started') {
      onSessionStarted(dataChannel, parsed);
      resolveStarted();
    }
  });
  dataChannel.addEventListener('open', () => onDataChannelOpen(dataChannel));
  dataChannel.addEventListener('close', () => {
    rejectStarted(new Error('Voice connection closed before startup completed.'));
    onDataChannelClose();
  });

  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await waitForIceGathering(peerConnection);
    const offerSdp = peerConnection.localDescription?.sdp || offer.sdp;
    const answerSdp = await connectSdp(sessionId, offerSdp, { signal });
    await peerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    if (isTutorLiveModel(model)) {
      startupTimer = setTimeout(() => rejectStarted(new Error('GPT-Live did not start. Please start a new session.')), 20000);
      await started;
      clearTimeout(startupTimer);
    }
  } catch (error) {
    clearTimeout(startupTimer);
    dataChannel.close();
    peerConnection.close();
    micStream.getTracks().forEach((track) => track.stop());
    throw error;
  }

  return {
    peerConnection,
    dataChannel,
    micStream,
    close() {
      try { dataChannel.close(); } catch (error) { /* Already closed. */ }
      try { peerConnection.close(); } catch (error) { /* Already closed. */ }
      micStream.getTracks().forEach((track) => track.stop());
    }
  };
}
