// Session renderer (device side). Captures the screen, creates the WebRTC offer,
// and relays signaling + input through the preload bridge (window.bvSession).
// No imports — uses browser globals + the preload API only.
let pc = null
let channel = null
let nonce = null

window.bvSession.onStart(async ({ nonce: n }) => {
  nonce = n
  try {
    await begin()
  } catch (e) {
    console.error('[bv-session] begin failed:', e && e.message)
  }
})

async function begin() {
  const src = await window.bvSession.getSource()
  if (!src) throw new Error('no screen source available')

  // Capture the whole screen via Electron's desktop media source.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: src.id,
        maxWidth: 1920,
        maxHeight: 1080,
        maxFrameRate: 30,
      },
    },
  })

  pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
  stream.getTracks().forEach((t) => pc.addTrack(t, stream))

  // The device creates the input channel; the console receives it and sends
  // mouse/keyboard events, which we forward to the main process to inject.
  channel = pc.createDataChannel('input')
  channel.onmessage = (e) => {
    try {
      window.bvSession.sendInput(JSON.parse(e.data))
    } catch {}
  }

  pc.onicecandidate = (e) => {
    if (e.candidate) window.bvSession.sendCandidate(nonce, e.candidate.toJSON())
  }

  window.bvSession.onAnswer(async (answer) => {
    try {
      if (pc.signalingState !== 'closed' && !pc.currentRemoteDescription) await pc.setRemoteDescription(answer)
    } catch (err) {
      console.error('[bv-session] setRemoteDescription:', err && err.message)
    }
  })
  window.bvSession.onAdminCandidate(async (c) => {
    try {
      await pc.addIceCandidate(c)
    } catch {}
  })

  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  window.bvSession.sendOffer(nonce, { type: offer.type, sdp: offer.sdp })
}
