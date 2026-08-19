import { useEffect, useState } from 'react'
import { loadDevices } from './data'
import { DevicePanel } from './panels'
import { c, ago } from '../../ui'

// The Remote tool: pick a fleet device on the left, control it on the right.
export default function RemotePage() {
  const [devices, setDevices] = useState([])
  const [selected, setSelected] = useState(null)
  const [err, setErr] = useState(null)

  async function refresh() {
    try { setDevices(await loadDevices()); setErr(null) }
    catch (e) { setErr('Cannot reach Firebase: ' + e.message) }
  }
  useEffect(() => { refresh(); const t = setInterval(refresh, 6000); return () => clearInterval(t) }, [])

  const device = devices.find((d) => d.id === selected) || null
  const online = devices.filter((d) => d.agentOnline).length

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20, alignItems: 'start' }}>
      <aside>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={c.h2}>Fleet devices</h2>
          {devices.length > 0 && <span style={{ fontSize: 12, color: 'var(--dim)' }}>{online} online / {devices.length}</span>}
        </div>
        {err && <div style={{ color: '#ff5c5c', fontSize: 13, marginBottom: 10 }}>{err}</div>}
        {devices.length === 0 ? (
          <div style={c.empty}>No devices yet.</div>
        ) : devices.map((d) => {
          const on = selected === d.id
          const label = !d.hasAgent ? 'no Remote agent' : d.agentOnline ? 'agent online' : `agent offline · ${ago(d.agentLastSeen)}`
          return (
            <button key={d.id} onClick={() => setSelected(d.id)}
              style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 8, cursor: 'pointer', background: on ? 'var(--panel2)' : 'transparent', border: `1px solid ${on ? 'var(--accent)' : 'var(--line)'}`, color: 'var(--text)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{d.name}</div>
              <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 3 }}><span style={c.dot(d.agentOnline)} />{label}</div>
            </button>
          )
        })}
      </aside>
      <main style={{ minWidth: 0 }}>
        {device ? <DevicePanel key={device.id} device={device} /> : <div style={{ ...c.empty, marginTop: 40 }}>Pick a device on the left to control it.</div>}
      </main>
    </div>
  )
}
