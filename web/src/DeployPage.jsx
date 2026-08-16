import { useEffect, useState } from 'react'
import { listManifest, listDevices, deployApp, deployFile, removeEntry } from './api'
import { c } from './ui'

const ONLINE_MS = 3 * 60 * 1000

export default function DeployPage() {
  const [devices, setDevices] = useState([])
  const [manifest, setManifest] = useState([])
  const [kind, setKind] = useState('app')
  const [name, setName] = useState('')
  const [version, setVersion] = useState('')
  const [silent, setSilent] = useState('')
  const [dest, setDest] = useState('')
  const [file, setFile] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  async function refresh() {
    try {
      const [d, m] = await Promise.all([listDevices(), listManifest()])
      setDevices(d)
      setManifest(m)
    } catch (e) {
      setMsg({ ok: false, text: 'Cannot reach Firebase: ' + e.message })
    }
  }
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 6000)
    return () => clearInterval(t)
  }, [])

  async function onDeploy(e) {
    e.preventDefault()
    if (!file) { setMsg({ ok: false, text: 'Choose a file first.' }); return }
    if (!name || !version) { setMsg({ ok: false, text: 'Name and version are required.' }); return }
    if (kind === 'file' && !dest) { setMsg({ ok: false, text: 'A file needs a destination path.' }); return }
    setBusy(true); setMsg({ ok: true, text: 'Uploading…' })
    try {
      if (kind === 'app') {
        await deployApp({ name, version, file, silentArgs: silent.split(',').map((s) => s.trim()).filter(Boolean) })
      } else {
        await deployFile({ name, version, file, dest })
      }
      setMsg({ ok: true, text: 'Deployed — devices will pull it on their next check.' })
      setName(''); setVersion(''); setSilent(''); setDest(''); setFile(null)
      e.target.reset()
      refresh()
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    }
    setBusy(false)
  }

  async function onRemove(n) {
    if (!confirm(`Remove "${n}"? (already-installed devices keep it)`)) return
    await removeEntry(n)
    refresh()
  }

  const now = Date.now()
  return (
    <>
      <section style={c.panel}>
        <h2 style={c.h2}>Connected devices</h2>
        <p style={c.sub}>Devices running the projectBV agent. Anything you deploy goes to these.</p>
        {devices.length === 0 ? (
          <div style={c.empty}>No devices yet — install the agent on a device and it appears here.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead><tr><th style={c.th}>Device</th><th style={c.th}>Version</th><th style={c.th}>Status</th></tr></thead>
            <tbody>
              {devices.map((d) => {
                const online = d.lastSeen && now - d.lastSeen < ONLINE_MS
                return (
                  <tr key={d.id || d.name}>
                    <td style={{ ...c.td, fontWeight: 600 }}>{d.name}</td>
                    <td style={c.td}>{d.version || '—'}</td>
                    <td style={c.td}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 8, marginRight: 7, background: online ? 'var(--ok)' : '#5a5f66' }} />
                      {online ? 'online' : 'offline'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      <section style={c.panel}>
        <h2 style={c.h2}>Send a file / app</h2>
        <p style={c.sub}>Uploads to your Firebase; every device pulls it automatically.</p>
        <div style={{ display: 'inline-flex', background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 9, padding: 3, marginBottom: 16 }}>
          {['app', 'file'].map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)}
              style={{ background: kind === k ? 'var(--accent)' : 'transparent', color: kind === k ? 'var(--accent-ink)' : 'var(--dim)', border: 0, padding: '7px 16px', borderRadius: 7, cursor: 'pointer', fontWeight: kind === k ? 600 : 400 }}>
              {k === 'app' ? 'App (installer)' : 'File'}
            </button>
          ))}
        </div>
        <form onSubmit={onDeploy}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div><label style={c.label}>Name (unique)</label><input style={c.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="AcmeTool" /></div>
            <div><label style={c.label}>Version</label><input style={c.input} value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.2.0" /></div>
            {kind === 'app' ? (
              <div style={{ gridColumn: '1/-1' }}><label style={c.label}>Silent install args (optional, comma-separated)</label><input style={c.input} value={silent} onChange={(e) => setSilent(e.target.value)} placeholder="/VERYSILENT, /NORESTART" /></div>
            ) : (
              <div style={{ gridColumn: '1/-1' }}><label style={c.label}>Destination path on the device</label><input style={c.input} value={dest} onChange={(e) => setDest(e.target.value)} placeholder="C:\\ProgramData\\MyApp\\config.json" /></div>
            )}
            <div style={{ gridColumn: '1/-1' }}>
              <label style={c.label}>File</label>
              <input type="file" onChange={(e) => setFile(e.target.files[0])} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
            <button type="submit" style={{ ...c.primary, opacity: busy ? 0.5 : 1 }} disabled={busy}>Deploy</button>
            {msg && <span style={{ fontSize: 13, color: msg.ok ? 'var(--ok)' : '#ff5c5c' }}>{msg.text}</span>}
          </div>
        </form>
      </section>

      <section style={c.panel}>
        <h2 style={c.h2}>Current deployments</h2>
        <p style={c.sub}>What every device pulls. Re-deploy with a higher version to push an update.</p>
        {manifest.length === 0 ? (
          <div style={c.empty}>Nothing published yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead><tr><th style={c.th}>Name</th><th style={c.th}>Version</th><th style={c.th}>Type</th><th style={c.th}>Destination / args</th><th style={c.th}></th></tr></thead>
            <tbody>
              {manifest.map((a) => (
                <tr key={a.name}>
                  <td style={{ ...c.td, fontWeight: 600 }}>{a.name}</td>
                  <td style={c.td}>{a.version}</td>
                  <td style={c.td}>{a.type || 'app'}</td>
                  <td style={c.td}>{a.type === 'file' ? a.dest : (a.silentArgs || []).join(' ') || '—'}</td>
                  <td style={{ ...c.td, textAlign: 'right' }}>
                    <button onClick={() => onRemove(a.name)} style={{ background: 'none', border: '1px solid var(--line)', color: '#ff5c5c', borderRadius: 7, padding: '5px 10px', cursor: 'pointer', fontSize: 12 }}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}
