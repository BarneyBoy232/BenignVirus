// projectBV cloud dashboard — shell.
// This is the Vercel-hosted site. Right now it's the layout only; the next step
// wires it to Supabase (device check-ins + file uploads to cloud storage).
const trefoil = (
  <svg width="30" height="30" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="49" fill="#111" />
    <circle cx="50" cy="50" r="44" fill="#ffd200" />
    <g fill="#111">
      <circle cx="50" cy="50" r="9" />
      <path d="M50 50 L36.4 26.5 A27 27 0 0 1 63.6 26.5 Z" />
      <path d="M50 50 L74.6 61.5 A27 27 0 0 1 61 85 Z" />
      <path d="M50 50 L39 85 A27 27 0 0 1 25.4 61.5 Z" />
    </g>
  </svg>
)

const panel = {
  background: 'var(--panel)', border: '1px solid var(--line)',
  borderRadius: 12, padding: 20, marginBottom: 22,
}
const sub = { margin: '0 0 12px', color: 'var(--dim)', fontSize: 13 }
const empty = { color: 'var(--dim)', textAlign: 'center', padding: 26 }

export default function App() {
  return (
    <div>
      <header style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '18px 24px',
        borderBottom: '1px solid var(--line)', background: 'var(--panel)',
      }}>
        {trefoil}
        <h1 style={{ fontSize: 17, margin: 0, fontWeight: 650 }}>projectBV — Deploy Dashboard</h1>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--dim)' }}>cloud · not connected yet</span>
      </header>

      <main style={{ maxWidth: 920, margin: '0 auto', padding: 24 }}>
        <div style={{
          ...panel, borderColor: 'var(--accent)', background: 'var(--panel2)',
          color: 'var(--text)', fontSize: 14,
        }}>
          <b>Site is live.</b> This is the projectBV dashboard deployed on Vercel. The next
          build step connects it to Supabase so it can show your devices and let you upload
          files/apps to the cloud — then your agents pull from here, no PC required.
        </div>

        <section style={panel}>
          <h2 style={{ margin: '0 0 4px', fontSize: 15 }}>Connected devices</h2>
          <p style={sub}>Devices running the projectBV agent will check in here.</p>
          <div style={empty}>No devices yet — connect the backend to see live check-ins.</div>
        </section>

        <section style={panel}>
          <h2 style={{ margin: '0 0 4px', fontSize: 15 }}>Send a file / app</h2>
          <p style={sub}>Upload an installer or file; every device pulls it automatically.</p>
          <div style={empty}>Upload form appears once the backend is connected.</div>
        </section>
      </main>
    </div>
  )
}
