import { connectTutorV2Sdp } from './tutor-v2-api.js';

function waitForIceGathering(peerConnection, timeoutMs = 1800) {
  if (peerConnection.iceGatheringState === 'complete') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      peerConnection.removeEventListener('icegatheringstatechange', handleChange);
      resolve();
    };
    const handleChange = () => {
      if (peerConnection.iceGatheringState === 'complete') finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    peerConnection.addEventListener('icegatheringstatechange', handleChange);
  });
}

export async function connectTutorV2WebRtc({
  sessionId,
  onEvent = () => {},
  onRemoteStream = () => {},
  onDataChannelOpen = () => {},
  onDataChannelClose = () => {},
  onConnectionState = () => {},
  mediaDevices = navigator.mediaDevices,
  PeerConnection = RTCPeerConnection,
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

  peerConnection.addEventListener('track', (event) => {
    const stream = event.streams?.[0];
    if (stream) onRemoteStream(stream);
  });
  peerConnection.addEventListener('connectionstatechange', () => {
    onConnectionState(peerConnection.connectionState);
  });
  micStream.getAudioTracks().forEach((track) => peerConnection.addTrack(track, micStream));

  dataChannel.addEventListener('message', (event) => {
    try {
      onEvent(JSON.parse(event.data));
    } catch (error) {
      // Ignore malformed Realtime events and keep the audio session alive.
    }
  });
  dataChannel.addEventListener('open', () => onDataChannelOpen(dataChannel));
  dataChannel.addEventListener('close', onDataChannelClose);

  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await waitForIceGathering(peerConnection);
    const offerSdp = peerConnection.localDescription?.sdp || offer.sdp;
    const answerSdp = await connectTutorV2Sdp(sessionId, offerSdp, { signal });
    await peerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  } catch (error) {
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

