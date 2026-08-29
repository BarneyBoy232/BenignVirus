// Numbers, colours and the two little chart pieces the Monitor tabs share.

export function bytes(n, digits = 1) {
  const v = Number(n) || 0
  if (v < 1024) return `${Math.round(v)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let x = v / 1024
  let i = 0
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++ }
  return `${x.toFixed(x >= 100 ? 0 : digits)} ${units[i]}`
}

export function rate(n) {
  const v = Number(n) || 0
  if (v < 1) return '—'
  return `${bytes(v, 1)}/s`
}

export function bits(n) {
  const v = Number(n) || 0
  if (v <= 0) return '—'
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)} Gbps`
  if (v >= 1e6) return `${Math.round(v / 1e6)} Mbps`
  return `${Math.round(v / 1e3)} Kbps`
}

export function duration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0))
  const d = Math.floor(s / 86400)
  const h = String(Math.floor((s % 86400) / 3600)).padStart(2, '0')
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${d}:${h}:${m}:${ss}`
}

export function when(ms) {
  if (!ms) return '—'
  return new Date(ms).toLocaleString()
}

// Task Manager shades a cell by how hot it is, which is how you find the busy row
// without reading a single number. Same idea, in this palette's amber.
export function heat(value, max) {
  const v = Math.max(0, Math.min(1, (Number(value) || 0) / (max || 100)))
  if (v < 0.02) return 'transparent'
  return `rgba(var(--chart-heat), ${(0.06 + v * 0.34).toFixed(3)})`
}

export const METRIC_COLOURS = {
  cpu: 'var(--chart-cpu)',
  mem: 'var(--chart-mem)',
  disk: 'var(--chart-disk)',
  net: 'var(--chart-net)',
  gpu: 'var(--chart-gpu)',
}

// A filled history chart. `values` runs oldest → newest and is drawn against a
// fixed ceiling so a quiet machine reads as quiet rather than being rescaled into
// looking busy.
let gridSeq = 0
export function Graph({ values, max = 100, colour = 'var(--chart-cpu)', height = 120, points = 60, gridId: given }) {
  const w = 300
  const h = 100
  const series = values.slice(-points)
  // Always plot a full-width series so the line grows in from the right as
  // history accumulates, the way Task Manager's does.
  const padded = Array(Math.max(0, points - series.length)).fill(null).concat(series)
  const step = w / Math.max(1, points - 1)
  const y = (v) => h - (Math.max(0, Math.min(max, v)) / (max || 1)) * h

  let d = ''
  let started = false
  padded.forEach((v, i) => {
    if (v === null || v === undefined) { started = false; return }
    const x = i * step
    d += `${started ? 'L' : 'M'}${x.toFixed(1)},${y(v).toFixed(1)}`
    started = true
  })
  const firstIdx = padded.findIndex((v) => v !== null && v !== undefined)
  const area = d && firstIdx >= 0
    ? `${d}L${w},${h}L${(firstIdx * step).toFixed(1)},${h}Z`
    : ''

  const gridId = given || `mg-${(gridSeq = (gridSeq + 1) % 100000)}`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block', background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 8 }}>
      <defs>
        <pattern id={gridId} width={w / 10} height={h / 5} patternUnits="userSpaceOnUse">
          <path d={`M${w / 10},0 L0,0 0,${h / 5}`} fill="none" stroke="var(--line)" strokeWidth="0.6" />
        </pattern>
      </defs>
      <rect width={w} height={h} fill={`url(#${gridId})`} />
      {area && <path d={area} fill={colour} opacity="0.18" />}
      {d && <path d={d} fill="none" stroke={colour} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />}
    </svg>
  )
}

// The small square-per-core grid on the CPU panel.
export function CoreGrid({ perCore = [], colour = 'var(--chart-cpu)' }) {
  const cols = Math.ceil(Math.sqrt(Math.max(1, perCore.length)))
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 4 }}>
      {perCore.map((v, i) => (
        <div key={i} title={`Core ${i}: ${v}%`} style={{ height: 26, borderRadius: 4, background: 'var(--panel2)', border: '1px solid var(--line)', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${Math.max(0, Math.min(100, v))}%`, background: colour, opacity: 0.55 }} />
        </div>
      ))}
    </div>
  )
}

// A labelled figure, used all over the performance panels.
export function Stat({ label, value, sub }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 1 }}>{sub}</div>}
    </div>
  )
}
