import { useEffect, useRef, useState } from 'react'
import { CMD } from './protocol'
import { runCommand } from './data'
import { startSession } from './session'
import { c } from '../../ui'

export function LivePanel({ device }) {
  const videoRef = useRef(null)
  const sessionRef = useRef(null)
  const lastMove = useRef(0)
  const [state, setState] = useState('idle')
  const [controlling, setControlling] = useState(false)
  const [perf, setPerf] = useState(null)

  function start() {
    if (sessionRef.current) return
    setState('connecting')
    sessionRef.current = startSession(device.id, {
      onStream: (stream) => { if (videoRef.current) videoRef.current.srcObject = stream },
      onState: (s) => setState(s),
    })
  }
  function stop() {
    setControlling(false)
    sessionRef.current?.stop()
    sessionRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setState('idle')
    setPerf(null)
  }
  useEffect(() => () => { sessionRef.current?.stop(); sessionRef.current = null }, [])

  useEffect(() => {
    if (state !== 'ready') return
    let alive = true
    let h = null
    async function tick() {
      try { const r = await runCommand(device.id, CMD.PERF, {}, 8000); if (alive) setPerf(r.output) } catch {}
      if (alive) h = setTimeout(tick, 3000)
    }
    tick()
    return () => { alive = false; if (h) clearTimeout(h) }
  }, [state, device.id])

  const send = (evt) => sessionRef.current?.sendInput(evt)
  function toRemote(e) {
    const v = videoRef.current
    const rect = v.getBoundingClientRect()
    const vw = v.videoWidth
    const vh = v.videoHeight
    if (!vw || !vh) return { x: 0, y: 0 }
    const scale = Math.min(rect.width / vw, rect.height / vh)
    const offX = (rect.width - vw * scale) / 2
    const offY = (rect.height - vh * scale) / 2
    const x = (e.clientX - rect.left - offX) / scale
    const y = (e.clientY - rect.top - offY) / scale
    return { x: Math.max(0, Math.min(vw, x)), y: Math.max(0, Math.min(vh, y)) }
  }
  function onMove(e) {
    if (!controlling) return
    const now = performance.now()
    if (now - lastMove.current < 30) return
    lastMove.current = now
    const { x, y } = toRemote(e)
    send({ t: 'm', x, y })
  }
  function onDown(e) { if (!controlling) return; e.preventDefault(); const { x, y } = toRemote(e); send({ t: 'm', x, y }); send({ t: 'd', b: e.button }) }
  function onUp(e) { if (!controlling) return; e.preventDefault(); send({ t: 'u', b: e.button }) }
  function onWheel(e) { if (!controlling) return; e.preventDefault(); send({ t: 'w', dy: Math.sign(e.deltaY) * 3 }) }

  useEffect(() => {
    if (!controlling) return
    const down = (e) => { e.preventDefault(); send({ t: 'k', a: 'down', code: e.code }) }
    const up = (e) => { e.preventDefault(); send({ t: 'k', a: 'up', code: e.code }) }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    return () => { window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true) }
  }, [controlling])

  useEffect(() => { if (['failed', 'disconnected', 'closed'].includes(state)) setControlling(false) }, [state])

  const connected = state === 'ready' || state === 'connected'
  const statusText = {
    idle: 'not connected', connecting: 'connecting…', ready: 'live', connected: 'live',
    disconnected: 'disconnected — press Stop, then start again',
    failed: 'connection failed — press Stop, then start again', closed: 'disconnected',
  }[state] || (state.startsWith('error') ? state.replace('error:', 'error: ') : state)

  return (
    <section style={c.panel}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <h2 style={c.h2}>Live screen</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span style={{ fontSize: 12, color: connected ? 'var(--ok)' : state.startsWith('error') ? '#ff5c5c' : 'var(--dim)' }}>
            <span style={c.dot(connected)} />{statusText}
          </span>
          {sessionRef.current ? (
            <button style={c.ghost} onClick={stop}>Stop</button>
          ) : (
            <button style={c.primary} onClick={start} disabled={!device.agentOnline}>Start live view</button>
          )}
        </div>
      </div>

      <div style={{ position: 'relative', background: '#000', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--line)', minHeight: 240 }}>
        <video ref={videoRef} autoPlay playsInline muted onMouseMove={onMove} onMouseDown={onDown} onMouseUp={onUp} onWheel={onWheel} onContextMenu={(e) => e.preventDefault()}
          style={{ display: 'block', width: '100%', maxHeight: '60vh', objectFit: 'contain', cursor: controlling ? 'crosshair' : 'default' }} />
        {!connected && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--dim)', fontSize: 13 }}>
            {state === 'connecting' ? 'Connecting to the device…' : 'Start the live view to see this device’s screen.'}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: connected ? 'pointer' : 'not-allowed', opacity: connected ? 1 : 0.5 }}>
          <input type="checkbox" disabled={!connected} checked={controlling} onChange={(e) => setControlling(e.target.checked)} />
          Take control (your mouse &amp; keyboard drive the device — they can still use theirs)
        </label>
        {perf && <span style={{ fontSize: 12, color: 'var(--dim)', marginLeft: 'auto' }}>this app is using — CPU {perf.agentCpuPct}% · RAM {perf.agentMemMB} MB</span>}
      </div>
    </section>
  )
}
