import { useEffect, useMemo, useState } from 'react'
import { c } from '../../ui'
import { loadCatalog } from './data'

// Services, startup entries and signed-in users change on the scale of minutes,
// not seconds, so they are fetched when you open the tab rather than streamed.
function useCatalog(deviceId, kind) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(false)

  const refresh = async () => {
    setLoading(true)
    try { setRows(await loadCatalog(deviceId, kind)); setErr(null) }
    catch (e) { setErr(e.message) }
    setLoading(false)
  }
  useEffect(() => { refresh() }, [deviceId, kind])
  return { rows, err, loading, refresh }
}

function Toolbar({ count, total, loading, onRefresh, children }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
      {children}
      <span style={{ fontSize: 12, color: 'var(--dim)' }}>{count === total ? `${total}` : `${count} of ${total}`}</span>
      <div style={{ flex: 1 }} />
      <button style={c.ghost} onClick={onRefresh} disabled={loading}>{loading ? 'Reading…' : 'Refresh'}</button>
    </div>
  )
}

function Shell({ state, err, children }) {
  if (err) return <div style={{ color: 'var(--bad)', fontSize: 13, padding: 16 }}>{err}</div>
  if (state === null) return <div style={c.empty}>Reading the device…</div>
  return children
}

const table = { width: '100%', borderCollapse: 'collapse', fontSize: 13 }
const wrap = { overflow: 'auto', maxHeight: '62vh', border: '1px solid var(--line)', borderRadius: 10 }
// A sticky header is the difference between a sortable table and one whose sort
// control scrolls away at row 40 of 288.
const th = { ...c.th, position: 'sticky', top: 0, zIndex: 1, background: 'var(--panel)' }

// --- services -------------------------------------------------------------
const SERVICE_STATES = { Running: 'var(--ok)', Stopped: '#7d848c' }

// Win32_Service reports Boot and System for driver services as well as the three
// Task Manager offers. Showing only three would make a Boot service read as
// Automatic and put it one click from being silently changed.
const START_MODES = [
  { value: 'automatic', label: 'Automatic', matches: ['auto', 'automatic'] },
  { value: 'manual', label: 'Manual', matches: ['manual'] },
  { value: 'disabled', label: 'Disabled', matches: ['disabled'] },
]
function startValue(mode) {
  const m = String(mode || '').toLowerCase()
  const hit = START_MODES.find((o) => o.matches.includes(m))
  return hit ? hit.value : `driver:${m}`
}

export function ServicesTab({ deviceId, onAct, busy }) {
  const { rows, err, loading, refresh } = useCatalog(deviceId, 'services')
  const [query, setQuery] = useState('')
  const [onlyRunning, setOnlyRunning] = useState(false)

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (rows || [])
      .filter((s) => (!onlyRunning || s.state === 'Running'))
      .filter((s) => !q || `${s.name} ${s.display}`.toLowerCase().includes(q))
      .sort((a, b) => String(a.display || a.name).localeCompare(String(b.display || b.name)))
  }, [rows, query, onlyRunning])

  const run = (name, op, display) => onAct(
    { action: 'service', name, op }, refresh,
    op === 'start' ? null : `${op === 'stop' ? 'Stop' : 'Restart'} "${display || name}" on this device?`,
  )

  return (
    <Shell state={rows} err={err}>
      <Toolbar count={list.length} total={(rows || []).length} loading={loading} onRefresh={refresh}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter" style={{ ...c.input, width: 200 }} />
        <label style={{ fontSize: 12, color: 'var(--dim)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={onlyRunning} onChange={(e) => setOnlyRunning(e.target.checked)} /> Running only
        </label>
      </Toolbar>
      <div style={wrap}>
        <table style={table}>
          <thead><tr>
            <th style={th}>Name</th><th style={th}>Service</th><th style={th}>Status</th>
            <th style={th}>Start type</th><th style={{ ...th, textAlign: 'right' }}>PID</th><th style={th}>Account</th>
            <th style={{ ...th, width: 200 }} />
          </tr></thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.name}>
                <td style={c.td}>{s.display || s.name}</td>
                <td style={{ ...c.td, color: 'var(--dim)', fontSize: 12 }}>{s.name}</td>
                <td style={{ ...c.td, color: SERVICE_STATES[s.state] || 'var(--text)' }}>{s.state}</td>
                <td style={c.td}>
                  <select value={startValue(s.start)} disabled={!!busy}
                    onChange={(e) => onAct({ action: 'service_start_type', name: s.name, mode: e.target.value }, refresh,
                      e.target.value === 'disabled' ? `Set "${s.display || s.name}" to Disabled? It will not start again until this is changed back.` : null)}
                    style={{ ...c.input, width: 'auto', padding: '5px 7px', fontSize: 12 }}>
                    {startValue(s.start).startsWith('driver:') && <option value={startValue(s.start)}>{s.start}</option>}
                    {START_MODES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </td>
                <td style={{ ...c.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{s.pid || '—'}</td>
                <td style={{ ...c.td, fontSize: 12, color: 'var(--dim)' }}>{s.account || '—'}</td>
                <td style={{ ...c.td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {s.state === 'Running'
                    ? <>
                        <button style={{ ...c.ghost, padding: '5px 10px', fontSize: 12, marginRight: 6 }} disabled={!!busy} onClick={() => run(s.name, 'restart', s.display)}>Restart</button>
                        <button style={{ ...c.ghost, padding: '5px 10px', fontSize: 12 }} disabled={!!busy} onClick={() => run(s.name, 'stop', s.display)}>Stop</button>
                      </>
                    : <button style={{ ...c.ghost, padding: '5px 10px', fontSize: 12 }} disabled={!!busy} onClick={() => run(s.name, 'start', s.display)}>Start</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  )
}

// --- startup --------------------------------------------------------------
const SOURCE_LABEL = { registry: 'Registry', folder: 'Startup folder', task: 'Scheduled task' }

export function StartupTab({ deviceId, onAct, busy }) {
  const { rows, err, loading, refresh } = useCatalog(deviceId, 'startup')
  const list = useMemo(() => [...(rows || [])].sort((a, b) => String(a.name).localeCompare(String(b.name))), [rows])

  return (
    <Shell state={rows} err={err}>
      <Toolbar count={list.length} total={list.length} loading={loading} onRefresh={refresh} />
      <div style={wrap}>
        <table style={table}>
          <thead><tr>
            <th style={th}>Name</th><th style={th}>Runs</th><th style={th}>From</th>
            <th style={th}>Scope</th><th style={th}>Status</th><th style={{ ...th, width: 110 }} />
          </tr></thead>
          <tbody>
            {list.map((s) => (
              <tr key={`${s.source}|${s.scope}|${s.name}`}>
                <td style={c.td}>{s.name}</td>
                <td style={{ ...c.td, fontSize: 12, color: 'var(--dim)', maxWidth: 380, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.command}>{s.command}</td>
                <td style={{ ...c.td, fontSize: 12 }}>{SOURCE_LABEL[s.source] || s.source}</td>
                <td style={{ ...c.td, fontSize: 12 }}>{s.scope === 'machine' ? 'All users' : 'This user'}</td>
                <td style={{ ...c.td, color: s.enabled ? 'var(--ok)' : '#7d848c' }}>{s.enabled ? 'Enabled' : 'Disabled'}</td>
                <td style={{ ...c.td, textAlign: 'right' }}>
                  <button style={{ ...c.ghost, padding: '5px 10px', fontSize: 12 }} disabled={!!busy}
                    onClick={() => onAct({ action: 'startup', entry: s, enabled: !s.enabled }, refresh,
                      s.enabled ? `Stop "${s.name}" running when this device signs in?` : null)}>
                    {s.enabled ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  )
}

// --- users ----------------------------------------------------------------
export function UsersTab({ deviceId, rows: procRows, onAct, busy }) {
  const { rows, err, loading, refresh } = useCatalog(deviceId, 'users')

  // What each signed-in session is costing the machine, added up from the live
  // process frame — the number that makes a users list worth looking at.
  const cost = useMemo(() => {
    const bySession = new Map()
    for (const r of procRows || []) {
      const k = r.session ?? -1
      const acc = bySession.get(k) || { cpu: 0, memB: 0, procs: 0 }
      acc.cpu += r.cpu || 0
      acc.memB += r.memB || 0
      acc.procs += 1
      bySession.set(k, acc)
    }
    return bySession
  }, [procRows])

  return (
    <Shell state={rows} err={err}>
      <Toolbar count={(rows || []).length} total={(rows || []).length} loading={loading} onRefresh={refresh} />
      <div style={wrap}>
        <table style={table}>
          <thead><tr>
            <th style={th}>User</th><th style={th}>Session</th><th style={{ ...th, textAlign: 'right' }}>ID</th>
            <th style={th}>State</th><th style={th}>Idle</th><th style={th}>Signed in</th>
            <th style={{ ...th, textAlign: 'right' }}>Processes</th><th style={{ ...th, textAlign: 'right' }}>CPU</th>
            <th style={{ ...th, width: 110 }} />
          </tr></thead>
          <tbody>
            {(rows || []).map((u) => {
              const k = cost.get(u.id) || { cpu: 0, procs: 0 }
              return (
                <tr key={`${u.user}-${u.id}`}>
                  <td style={c.td}>{u.user}</td>
                  <td style={c.td}>{u.session || '—'}</td>
                  <td style={{ ...c.td, textAlign: 'right' }}>{u.id > 0 ? u.id : '—'}</td>
                  <td style={{ ...c.td, color: u.state === 'Active' ? 'var(--ok)' : 'var(--text)' }}>{u.state || '—'}</td>
                  <td style={c.td}>{u.idle || '—'}</td>
                  <td style={c.td}>{u.logon || '—'}</td>
                  <td style={{ ...c.td, textAlign: 'right' }}>{k.procs || '—'}</td>
                  <td style={{ ...c.td, textAlign: 'right' }}>{k.cpu ? `${k.cpu.toFixed(1)}%` : '—'}</td>
                  <td style={{ ...c.td, textAlign: 'right' }}>
                    {u.id > 0 && <button style={{ ...c.ghost, padding: '5px 10px', fontSize: 12, borderColor: 'var(--bad)', color: 'var(--bad)' }} disabled={!!busy}
                      onClick={() => onAct({ action: 'sign_out', session: u.id }, refresh,
                        `Sign ${u.user} out of this device? Anything they have open and unsaved is lost.`)}>Sign out</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Shell>
  )
}
