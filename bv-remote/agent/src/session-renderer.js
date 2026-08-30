// Session renderer (device side). Captures the screen, creates the WebRTC offer,
// and relays signaling + input through the preload bridge (window.bvSession).
// No imports — uses browser globals + the preload API only.
let pc = null
let channel = null
let nonce = null
let videoSender = null

// The encoder's ceiling. The governor in the main process moves the live target
// up and down under this to keep the machine under 80%.
const MAX_BITRATE = 20_000_000 // 20 Mbps — headroom for a smooth 60fps 1080p desktop

// applyFps changes the streaming framerate on the fly without renegotiating.
function applyFps(fps) {
  if (!videoSender) return
  const params = videoSender.getParameters()
  if (!params.encodings || !params.encodings.length) params.encodings = [{}]
  params.encodings[0].maxFramerate = fps
  params.encodings[0].maxBitrate = MAX_BITRATE
  videoSender.setParameters(params).catch(() => {})
}

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

  // Capture the whole screen via Electron's desktop media source. Ask for up to
  // 60fps; the governor throttles it down live if the machine gets busy.
  //
  // Audio is the DEVICE's whole system sound (loopback) — Chromium can capture a
  // single window's video but not a single app's audio, so "hear their sounds"
  // means everything the machine is playing. The console keeps it muted until you
  // ask to listen. If audio capture isn't available, we fall back to video only
  // rather than failing the whole session.
  const videoConstraint = {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: src.id,
      maxWidth: 1920,
      maxHeight: 1080,
      maxFrameRate: 60,
    },
  }
  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'desktop' } },
      video: videoConstraint,
    })
  } catch (e) {
    console.warn('[bv-session] no system audio, streaming video only:', e && e.message)
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraint })
  }

  // What came back is not necessarily what was asked for: the capture is scaled to
  // fit inside 1920x1080 with the aspect kept. The main process needs the real
  // figure to map a click back onto this machine's screen, so report it rather
  // than assume it.
  const track = stream.getVideoTracks()[0]
  const settings = (track && track.getSettings && track.getSettings()) || {}
  window.bvSession.reportCapture({ width: settings.width || 0, height: settings.height || 0 })

  pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
  stream.getTracks().forEach((t) => {
    // 'motion' tells the encoder to favour a smooth framerate over pin-sharp
    // stills — the right trade for driving a live desktop.
    if (t.kind === 'video') t.contentHint = 'motion'
    pc.addTrack(t, stream)
  })
  videoSender = pc.getSenders().find((s) => s.track && s.track.kind === 'video') || null
  // Keep the framerate high even under load: drop resolution before frames. This
  // is what makes the stream feel fast rather than sharp-but-choppy.
  if (videoSender) {
    const params = videoSender.getParameters()
    params.degradationPreference = 'maintain-framerate'
    videoSender.setParameters(params).catch(() => {})
  }
  applyFps(60) // start at the ceiling; the governor eases it down only if needed

  // The main process nudges the framerate up and down to hold the machine < 80%.
  window.bvSession.onSetFps && window.bvSession.onSetFps((fps) => applyFps(fps))

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
