import { c } from '../../ui'
import { bytes, bits, rate, duration, Graph, CoreGrid, Stat, METRIC_COLOURS } from './format'

// An SVG pattern id has to be a plain token, and two panels sharing one would make
// both draw the first panel's grid.
const slug = (s) => String(s).replace(/[^a-zA-Z0-9]/g, '')

// Every performance panel is the same shape: a title, a live figure, a history
// chart and a row of numbers underneath it.
function Panel({ title, headline, colour, values, max, children, footer, gridId }) {
  return (
    <div style={c.panel}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 650 }}>{title}</h3>
        <span style={{ fontSize: 18, fontWeight: 650, color: colour, fontVariantNumeric: 'tabular-nums' }}>{headline}</span>
      </div>
      <Graph values={values} max={max} colour={colour} gridId={gridId} />
      {children && <div style={{ marginTop: 14 }}>{children}</div>}
      {footer && <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 10 }}>{footer}</div>}
    </div>
  )
}

function Numbers({ items }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 14 }}>
      {items.map(([label, value, sub]) => <Stat key={label} label={label} value={value} sub={sub} />)}
    </div>
  )
}

export default function PerformanceTab({ sample, machine, history }) {
  if (!sample) return <div style={c.empty}>Waiting for the first frame…</div>

  const mem = sample.mem || {}
  const usedB = Math.max(0, (mem.totalB || 0) - (mem.availableB || 0))
  const memPct = mem.totalB ? (usedB / mem.totalB) * 100 : 0

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 18, alignItems: 'start' }}>
      <Panel title="CPU" gridId="mg-cpu" colour={METRIC_COLOURS.cpu} headline={`${sample.cpu?.pct ?? 0}%`}
        values={history.cpu} max={100}
        footer={machine?.cpuName}>
        <div style={{ display: 'grid', gap: 14 }}>
          <CoreGrid perCore={sample.cpu?.perCore || []} colour={METRIC_COLOURS.cpu} />
          <Numbers items={[
            ['Processes', sample.counts?.processes ?? '—'],
            ['Threads', sample.counts?.threads ?? '—'],
            ['Queue', sample.cpu?.queue ?? '—'],
            ['Cores', machine?.cores ?? '—', machine?.sockets ? `${machine.sockets} socket(s)` : null],
            ['Base speed', machine?.cpuMaxMHz ? `${(machine.cpuMaxMHz / 1000).toFixed(2)} GHz` : '—'],
            ['Up time', duration(sample.counts?.upSec)],
          ]} />
        </div>
      </Panel>

      <Panel title="Memory" gridId="mg-mem" colour={METRIC_COLOURS.mem} headline={`${Math.round(memPct)}%`}
        values={history.mem} max={100}
        footer={`${bytes(mem.totalB)} installed`}>
        <Numbers items={[
          ['In use', bytes(usedB)],
          ['Available', bytes(mem.availableB)],
          ['Committed', `${bytes(mem.committedB)} / ${bytes(mem.commitLimitB)}`],
          ['Cached', bytes(mem.cachedB)],
          ['Paged pool', bytes(mem.pagedPoolB)],
          ['Non-paged pool', bytes(mem.nonPagedB)],
          ['Page faults', `${mem.faultsPerSec ?? 0}/s`],
        ]} />
      </Panel>

      {(sample.disks || []).map((d) => (
        <Panel key={d.name} title={`Disk ${d.name}`} gridId={`mg-d-${slug(d.name)}`} colour={METRIC_COLOURS.disk}
          headline={`${d.activePct}%`} values={history.disk[d.name] || []} max={100}>
          <Numbers items={[
            ['Read', rate(d.readBps)],
            ['Write', rate(d.writeBps)],
            ['Active time', `${d.activePct}%`],
            ['Queue length', d.queue],
          ]} />
        </Panel>
      ))}

      {(sample.nets || []).map((n) => {
        const total = (n.sendBps || 0) + (n.recvBps || 0)
        const series = history.net[n.name] || []
        return (
          <Panel key={n.name} title={n.name} gridId={`mg-n-${slug(n.name)}`} colour={METRIC_COLOURS.net}
            headline={rate(total)} values={series}
            max={Math.max(1, ...series)}>
            <Numbers items={[
              ['Send', rate(n.sendBps)],
              ['Receive', rate(n.recvBps)],
              ['Link speed', bits(n.linkBps)],
            ]} />
          </Panel>
        )
      })}

      {sample.gpu && (
        <Panel title="GPU" gridId="mg-gpu" colour={METRIC_COLOURS.gpu} headline={`${sample.gpu.totalPct}%`}
          values={history.gpu} max={100}>
          <Numbers items={[
            ['Utilisation', `${sample.gpu.totalPct}%`],
            ['Dedicated memory', sample.gpu.memB ? bytes(sample.gpu.memB) : '—'],
          ]} />
        </Panel>
      )}

      {(sample.vols || []).length > 0 && (
        <div style={c.panel}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 650 }}>Storage</h3>
          <div style={{ display: 'grid', gap: 12 }}>
            {sample.vols.map((v) => {
              const usedPct = v.sizeB ? ((v.sizeB - v.freeB) / v.sizeB) * 100 : 0
              const tight = usedPct >= 90
              return (
                <div key={v.name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 5 }}>
                    <span>{v.name} {v.label && <span style={{ color: 'var(--dim)' }}>{v.label}</span>}</span>
                    <span style={{ color: tight ? 'var(--bad)' : 'var(--dim)', fontVariantNumeric: 'tabular-nums' }}>
                      {bytes(v.freeB)} free of {bytes(v.sizeB)}
                    </span>
                  </div>
                  <div style={{ height: 8, borderRadius: 4, background: 'var(--panel2)', border: '1px solid var(--line)', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, usedPct)}%`, height: '100%', background: tight ? 'var(--bad)' : METRIC_COLOURS.disk }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
