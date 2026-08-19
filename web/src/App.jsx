import { useState } from 'react'
import DeployPage from './DeployPage'
import { TOOLS } from './tools'
import { trefoilSvg, c } from './ui'

export default function App() {
  const [view, setView] = useState({ kind: 'deploy' })
  const isTools = view.kind === 'tools' || view.kind === 'tool'

  const navItem = (active, label, onClick) => (
    <button onClick={onClick} style={{ background: 'none', border: 0, borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`, color: active ? 'var(--text)' : 'var(--dim)', padding: '10px 4px', marginRight: 22, cursor: 'pointer', fontSize: 14, fontWeight: active ? 600 : 400 }}>
      {label}
    </button>
  )

  return (
    <div>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px', borderBottom: '1px solid var(--line)', background: 'var(--panel)' }}>
        <span style={{ display: 'inline-flex' }} dangerouslySetInnerHTML={trefoilSvg(28)} />
        <h1 style={{ fontSize: 17, margin: 0, fontWeight: 650 }}>projectBV</h1>
        <nav style={{ marginLeft: 22, display: 'flex' }}>
          {navItem(view.kind === 'deploy', 'Deploy', () => setView({ kind: 'deploy' }))}
          {navItem(isTools, 'Tools', () => setView({ kind: 'tools' }))}
        </nav>
      </header>
      <main style={{ maxWidth: isTools ? 1120 : 920, margin: '0 auto', padding: 24 }}>
        {view.kind === 'deploy' && <DeployPage />}
        {view.kind === 'tools' && <ToolsLanding onOpen={(id) => setView({ kind: 'tool', id })} />}
        {view.kind === 'tool' && <ToolView id={view.id} onBack={() => setView({ kind: 'tools' })} />}
      </main>
    </div>
  )
}

function ToolsLanding({ onOpen }) {
  return (
    <>
      <h2 style={{ ...c.h2, fontSize: 18, marginBottom: 4 }}>Tools</h2>
      <p style={{ ...c.sub, marginBottom: 20 }}>Add-on tools that plug into your projectBV fleet. More can be added over time.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 16 }}>
        {TOOLS.map((t) => (
          <button key={t.id} onClick={() => onOpen(t.id)} style={{ textAlign: 'left', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: 18, cursor: 'pointer', color: 'var(--text)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ display: 'inline-flex' }} dangerouslySetInnerHTML={t.icon(22)} />
              <span style={{ fontWeight: 650, fontSize: 15 }}>{t.name}</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--dim)' }}>{t.tagline}</div>
          </button>
        ))}
        <div style={{ border: '1px dashed var(--line)', borderRadius: 12, padding: 18, color: 'var(--dim)', fontSize: 13, display: 'grid', placeItems: 'center', textAlign: 'center' }}>More tools coming</div>
      </div>
    </>
  )
}

function ToolView({ id, onBack }) {
  const tool = TOOLS.find((t) => t.id === id)
  if (!tool) return <div style={c.empty}>Unknown tool.</div>
  const Comp = tool.component
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <button onClick={onBack} style={{ ...c.ghost, fontSize: 13 }}>← Tools</button>
        <span style={{ display: 'inline-flex' }} dangerouslySetInnerHTML={tool.icon(20)} />
        <h2 style={{ ...c.h2, fontSize: 17, margin: 0 }}>{tool.name}</h2>
      </div>
      <Comp />
    </>
  )
}
