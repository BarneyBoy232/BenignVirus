import { useEffect, useState } from 'react'
import { loadDevices } from './data'
import { DevicePanel } from './panels'
import { watchAgentManifest, publishAgent, unpublishAgent, agentReady, AGENT } from './deploy'
import { c, ago } from '../../ui'

// The Remote tool: install the agent on the fleet, then pick a device to control.
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
    <>
      <InstallBanner devices={devices} />
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
            const label = !d.hasAgent ? 'no Remote agent' : d.agentOnline ? `online · ${d.enabled ? 'enabled' : 'off'}` : `agent offline · ${ago(d.agentLastSeen)}`
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
          {device ? <DevicePanel key={device.id} device={device} /> : <div style={{ ...c.empty, marginTop: 40 }}>Pick a device on the left to control it — or install the agent on your fleet above.</div>}
        </main>
      </div>
    </>
  )
}

function InstallBanner({ devices }) {
  const [manifest, setManifest] = useState(undefined) // undefined=loading, null=not published, object=published
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  useEffect(() => watchAgentManifest(setManifest), [])

  const withAgent = devices.filter((d) => d.hasAgent).length
  const total = devices.length
  const ready = agentReady()
  const published = !!(manifest && manifest.name)

  async function install() {
    setBusy(true); setMsg(null)
    try { await publishAgent(); setMsg({ ok: true, text: `Publishing v${AGENT.version} to the fleet — every device installs it on its next check-in (about a minute).` }) }
    catch (e) { setMsg({ ok: false, text: e.message }) }
    setBusy(false)
  }
  async function remove() {
    if (!window.confirm('Stop deploying the Remote agent to new devices? Devices that already have it keep it.')) return
    setBusy(true); setMsg(null)
    try { await unpublishAgent() } catch (e) { setMsg({ ok: false, text: e.message }) }
    setBusy(false)
  }

  return (
    <section style={{ ...c.panel, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div>
          <h2 style={c.h2}>Install Remote on your fleet</h2>
          <p style={{ ...c.sub, margin: '4px 0 0' }}>
            {published ? `Deployed to the fleet (v${manifest.version}) — every device installs it automatically.` : 'One click installs the Remote agent on every fleet device at once.'}
            {total > 0 && ` · ${withAgent} of ${total} device${total === 1 ? '' : 's'} have it.`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {!ready && <span style={{ fontSize: 12, color: 'var(--dim)' }}>preparing installer…</span>}
          <button style={{ ...c.primary, opacity: busy || !ready ? 0.5 : 1 }} disabled={busy || !ready} onClick={install}>
            {published ? 'Re-install / update on all devices' : 'Install on all devices'}
          </button>
          {published && <button style={c.ghost} disabled={busy} onClick={remove}>Stop deploying</button>}
        </div>
      </div>
      {msg && <div style={{ marginTop: 10, fontSize: 13, color: msg.ok ? 'var(--ok)' : '#ff5c5c' }}>{msg.text}</div>}
      <p style={{ ...c.sub, margin: '10px 0 0', fontSize: 12 }}>Installs on every device, but each one stays <strong>dormant</strong> until you enable it below — so you choose which devices are actually controllable. The person using a device sees nothing either way.</p>
    </section>
  )
}
