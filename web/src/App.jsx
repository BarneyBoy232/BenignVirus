import DeployPage from './DeployPage'
import { trefoilSvg } from './ui'

export default function App() {
  return (
    <div>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 24px', borderBottom: '1px solid var(--line)', background: 'var(--panel)' }}>
        <span style={{ display: 'inline-flex' }} dangerouslySetInnerHTML={trefoilSvg(30)} />
        <h1 style={{ fontSize: 17, margin: 0, fontWeight: 650 }}>projectBV — Deploy Dashboard</h1>
      </header>
      <main style={{ maxWidth: 920, margin: '0 auto', padding: 24 }}>
        <DeployPage />
      </main>
    </div>
  )
}
