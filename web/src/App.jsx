import { useState } from 'react'
import DeployPage from './DeployPage'
import WorkshopPage from './WorkshopPage'
import { trefoilSvg } from './ui'

// Pages are modular — add a new one by dropping in a component and listing it here.
const PAGES = [
  { key: 'deploy', label: 'Deploy', render: () => <DeployPage /> },
  { key: 'workshop', label: 'Workshop', render: () => <WorkshopPage /> },
]

export default function App() {
  const [page, setPage] = useState('deploy')
  const current = PAGES.find((p) => p.key === page) || PAGES[0]

  return (
    <div>
      <header style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 24px', borderBottom: '1px solid var(--line)', background: 'var(--panel)', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex' }} dangerouslySetInnerHTML={trefoilSvg(30)} />
        <h1 style={{ fontSize: 17, margin: 0, fontWeight: 650 }}>projectBV</h1>
        <nav style={{ display: 'inline-flex', gap: 4, marginLeft: 8, background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 9, padding: 3 }}>
          {PAGES.map((p) => (
            <button key={p.key} onClick={() => setPage(p.key)}
              style={{ background: page === p.key ? 'var(--accent)' : 'transparent', color: page === p.key ? 'var(--accent-ink)' : 'var(--dim)', border: 0, padding: '6px 14px', borderRadius: 7, cursor: 'pointer', fontWeight: page === p.key ? 650 : 400, font: 'inherit' }}>
              {p.label}
            </button>
          ))}
        </nav>
      </header>

      <main style={{ maxWidth: 920, margin: '0 auto', padding: 24 }}>
        {current.render()}
      </main>
    </div>
  )
}
