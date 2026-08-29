import { useEffect, useMemo, useState } from 'react'
import { c } from '../../ui'
import { bytes, rate, heat, duration, when } from './format'

// Windows' own service accounts. A process running as one of these is the
// operating system doing its job, which Task Manager separates out so the list
// you scroll is the list you might act on.
const SYSTEM_USERS = ['SYSTEM', 'LOCAL SERVICE', 'NETWORK SERVICE', 'LOCALSYSTEM']

export function groupOf(row) {
  if (row.title) return 'app'
  const u = String(row.user || '').split('\\').pop().toUpperCase()
  if (SYSTEM_USERS.includes(u) || (!row.user && row.session === 0)) return 'windows'
  return 'background'
}

const GROUPS = [
  { key: 'app', label: 'Apps' },
  { key: 'background', label: 'Background processes' },
  { key: 'windows', label: 'Windows processes' },
]

const PRIORITIES = ['realtime', 'high', 'abovenormal', 'normal', 'belownormal', 'low']

const COLUMNS = {
  name: { label: 'Name', width: 'auto', get: (r) => r.label },
  pid: { label: 'PID', width: 70, num: true, get: (r) => r.pid },
  status: { label: 'Status', width: 90, get: (r) => r.status || '' },
  user: { label: 'User', width: 130, get: (r) => (r.user || '').split('\\').pop() },
  cpu: { label: 'CPU', width: 70, num: true, get: (r) => r.cpu },
  mem: { label: 'Memory', width: 90, num: true, get: (r) => r.memB },
  io: { label: 'Disk / net', width: 95, num: true, get: (r) => r.ioBps },
  gpu: { label: 'GPU', width: 70, num: true, get: (r) => r.gpuPct },
  threads: { label: 'Threads', width: 75, num: true, get: (r) => r.threads },
  handles: { label: 'Handles', width: 80, num: true, get: (r) => r.handles },
  session: { label: 'Session', width: 70, num: true, get: (r) => r.session },
  up: { label: 'Running for', width: 105, num: true, get: (r) => r.upSec },
}

const GROUPED_COLS = ['name', 'status', 'cpu', 'mem', 'io', 'gpu']
const FLAT_COLS = ['name', 'pid', 'status', 'user', 'cpu', 'mem', 'io', 'gpu', 'threads', 'handles', 'session', 'up']

// The table re-sorts on every frame, so a row can move out from under the pointer
// between aiming at it and clicking it — and the click that lands selects whatever
// arrived in its place. Holding the order still while a row is selected removes
// that entirely, and the pause is visible so it never looks like a stalled stream.
export default function ProcessesTab({ rows, machine, flat = false, onAct, busy, note }) {
  const [sort, setSort] = useState({ key: 'cpu', dir: -1 })
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)
  const [frozen, setFrozen] = useState(null)
  const cols = flat ? FLAT_COLS : GROUPED_COLS

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      r.label.toLowerCase().includes(q) ||
      String(r.pid).includes(q) ||
      String(r.user || '').toLowerCase().includes(q) ||
      String(r.path || '').toLowerCase().includes(q))
  }, [rows, query])

  const sorted = useMemo(() => {
    const col = COLUMNS[sort.key]
    const list = [...filtered]
    list.sort((a, b) => {
      const av = col.get(a)
      const bv = col.get(b)
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sort.dir
      return String(av ?? '').localeCompare(String(bv ?? '')) * sort.dir
    })
    return list
  }, [filtered, sort])

  // Selecting a row snapshots the current order; the numbers in it keep updating,
  // only the positions stop moving.
  useEffect(() => { setFrozen(selected === null ? null : sorted.map((r) => r.pid)) }, [selected, sort.key, sort.dir, query])

  const ordered = useMemo(() => {
    if (!frozen) return sorted
    const byPid = new Map(sorted.map((r) => [r.pid, r]))
    const kept = frozen.map((p) => byPid.get(p)).filter(Boolean)
    const fresh = sorted.filter((r) => !frozen.includes(r.pid))
    return [...kept, ...fresh]
  }, [sorted, frozen])

  const sections = useMemo(() => {
    if (flat) return [{ key: 'all', label: null, rows: ordered }]
    return GROUPS.map((g) => ({ ...g, rows: ordered.filter((r) => r.group === g.key) })).filter((s) => s.rows.length)
  }, [ordered, flat])

  // The toolbar follows the selected pid, not its row in the visible list, so
  // filtering it out of view never silently disarms the buttons.
  const sel = rows.find((r) => r.pid === selected) || null
  const cores = machine?.cores || 1

  const header = (key) => {
    const col = COLUMNS[key]
    const on = sort.key === key
    return (
      <th key={key} style={{ ...c.th, position: 'sticky', top: 0, zIndex: 1, background: 'var(--panel)', width: col.width === 'auto' ? undefined : col.width, textAlign: col.num ? 'right' : 'left', cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }}
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : (col.num ? -1 : 1) }))}>
        {col.label}{on ? (sort.dir < 0 ? ' ▾' : ' ▴') : ''}
      </th>
    )
  }

  const cell = (r, key) => {
    const col = COLUMNS[key]
    const style = { ...c.td, textAlign: col.num ? 'right' : 'left', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }
    if (key === 'name') {
      return (
        <td key={key} style={{ ...style, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
          <div style={{ fontWeight: 550 }}>{r.label}</div>
          {r.label !== r.name && <div style={{ fontSize: 11, color: 'var(--dim)' }}>{r.name}</div>}
        </td>
      )
    }
    if (key === 'cpu') return <td key={key} style={{ ...style, background: heat(r.cpu, 25) }}>{r.cpu > 0 ? `${r.cpu.toFixed(1)}%` : '—'}</td>
    if (key === 'mem') return <td key={key} style={{ ...style, background: heat(r.memB, (machine?.totalMemB || 8e9) / 6) }}>{bytes(r.memB)}</td>
    if (key === 'io') return <td key={key} style={{ ...style, background: heat(r.ioBps, 20e6) }}>{rate(r.ioBps)}</td>
    if (key === 'gpu') return <td key={key} style={{ ...style, background: heat(r.gpuPct, 25) }}>{r.gpuPct > 0 ? `${r.gpuPct.toFixed(1)}%` : '—'}</td>
    if (key === 'up') return <td key={key} style={style}>{duration(r.upSec)}</td>
    return <td key={key} style={style}>{col.get(r) || '—'}</td>
  }

  const endTask = (tree) => onAct(
    { action: 'end_task', pid: sel.pid, tree },
    null,
    `${tree ? 'End the whole tree under' : 'End'} ${sel.label} (${sel.pid}) on this device? Unsaved work in it is lost.`,
  )

  return (
    <>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter"
          style={{ ...c.input, width: 200 }} />
        <span style={{ fontSize: 12, color: 'var(--dim)' }}>{ordered.length} of {rows.length}</span>
        {frozen && <span style={{ fontSize: 12, color: 'var(--dim)' }}>order held</span>}
        <div style={{ flex: 1 }} />
        {sel && (
          <>
            <span style={{ fontSize: 12, color: 'var(--dim)' }}>{sel.label} · {sel.pid}</span>
            <select value="" disabled={!!busy} onChange={(e) => { if (e.target.value) onAct({ action: 'set_priority', pid: sel.pid, priority: e.target.value }) }}
              style={{ ...c.input, width: 'auto', padding: '7px 9px' }}>
              <option value="">Priority…</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <Affinity cores={cores} busy={busy} onPick={(mask) => onAct({ action: 'set_affinity', pid: sel.pid, mask })} />
            <button style={c.ghost} disabled={!!busy} onClick={() => endTask(true)}>End tree</button>
            <button style={{ ...c.ghost, borderColor: 'var(--bad)', color: 'var(--bad)' }} disabled={!!busy} onClick={() => endTask(false)}>End task</button>
          </>
        )}
      </div>

      {note && <div style={{ fontSize: 12, color: note.bad ? 'var(--bad)' : 'var(--dim)', marginBottom: 10 }}>{note.text}</div>}

      <div style={{ overflow: 'auto', maxHeight: '58vh', border: '1px solid var(--line)', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr>{cols.map(header)}</tr></thead>
          <tbody>
            {sections.map((s) => (
              <Section key={s.key} label={s.label} span={cols.length}>
                {s.rows.map((r) => (
                  <tr key={r.pid} onClick={() => setSelected(r.pid === selected ? null : r.pid)}
                    style={{ cursor: 'pointer', background: r.pid === selected ? 'var(--panel2)' : 'transparent' }}>
                    {cols.map((k) => cell(r, k))}
                  </tr>
                ))}
              </Section>
            ))}
            {ordered.length === 0 && <tr><td colSpan={cols.length} style={c.empty}>Nothing matches.</td></tr>}
          </tbody>
        </table>
      </div>

      {sel && <Details row={sel} cores={cores} />}
    </>
  )
}

// Task Manager's "Set affinity": one bit per logical processor. Presets rather than
// a checkbox per core, because the useful shapes are "give it everything" and
// "keep it off most of the machine".
function Affinity({ cores, busy, onPick }) {
  const all = cores >= 31 ? 0x7fffffff : (1 << cores) - 1
  const options = [
    ['All cores', all],
    ['Half', (1 << Math.max(1, Math.floor(cores / 2))) - 1],
    ['One core', 1],
  ]
  return (
    <select value="" disabled={!!busy} onChange={(e) => { if (e.target.value) onPick(Number(e.target.value)) }}
      style={{ ...c.input, width: 'auto', padding: '7px 9px' }}>
      <option value="">Cores…</option>
      {options.map(([label, mask]) => <option key={label} value={mask}>{label}</option>)}
    </select>
  )
}

function Section({ label, span, children }) {
  if (!label) return children
  return (
    <>
      <tr><td colSpan={span} style={{ ...c.td, background: 'var(--panel2)', fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--dim)' }}>{label}</td></tr>
      {children}
    </>
  )
}

function Details({ row, cores }) {
  const fields = [
    ['Process', `${row.name} (${row.pid})`],
    ['Description', row.desc || '—'],
    ['Window', row.title || 'no window'],
    ['User', row.user || '—'],
    ['Session', row.session ?? '—'],
    ['Started', when(row.started)],
    ['Running for', duration(row.upSec)],
    ['Threads', row.threads],
    ['Handles', row.handles],
    ['Parent PID', row.ppid ?? '—'],
    ['Path', row.path || '—'],
    ['Command line', row.cmdline || '—'],
  ]
  return (
    <div style={{ ...c.panel, marginTop: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 14 }}>
        {fields.map(([k, v]) => (
          <div key={k}>
            <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 2 }}>{k}</div>
            <div style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{String(v)}</div>
          </div>
        ))}
      </div>
      {!row.path && (
        <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 12 }}>
          Path and command line are blank for processes this agent does not own — Windows withholds them from an unelevated reader, on {cores === 1 ? 'this machine' : 'every machine'}.
        </div>
      )}
    </div>
  )
}
