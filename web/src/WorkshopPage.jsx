import { useEffect, useState } from 'react'
import { listWorkshop, addWorkshop, removeWorkshop } from './api'
import { c } from './ui'

// The Workshop: a directory of linked builds/pages. Each card points at a page —
// an external app/site you (or a future build) create that uses projectBV's
// tunnel, or an internal route added into this codebase like lego.
export default function WorkshopPage() {
  const [items, setItems] = useState([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  async function refresh() {
    try { setItems(await listWorkshop()) } catch { /* ignore */ }
  }
  useEffect(() => { refresh() }, [])

  async function onAdd(e) {
    e.preventDefault()
    if (!title || !url) return
    setBusy(true)
    try {
      await addWorkshop({ title, description, url })
      setTitle(''); setDescription(''); setUrl('')
      refresh()
    } finally { setBusy(false) }
  }

  async function onRemove(id) {
    if (!confirm('Remove this build from the workshop?')) return
    await removeWorkshop(id)
    refresh()
  }

  return (
    <>
      <section style={c.panel}>
        <h2 style={c.h2}>Workshop</h2>
        <p style={c.sub}>
          A directory of builds — apps or pages that use projectBV's tunnel. Link an external
          app, or a page added into this dashboard. Add as many as you like.
        </p>
        {items.length === 0 ? (
          <div style={c.empty}>No builds yet — add your first one below.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 14 }}>
            {items.map((it) => (
              <div key={it.id} style={{ background: 'var(--panel2)', border: '1px solid var(--line)', borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontWeight: 650 }}>{it.title}</div>
                <div style={{ color: 'var(--dim)', fontSize: 13, flex: 1, overflowWrap: 'anywhere' }}>{it.description}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <a href={it.url} target="_blank" rel="noreferrer" style={{ ...c.primary, textDecoration: 'none', fontSize: 13, padding: '7px 14px' }}>Open</a>
                  <button onClick={() => onRemove(it.id)} style={{ background: 'none', border: '1px solid var(--line)', color: '#ff5c5c', borderRadius: 7, padding: '6px 10px', cursor: 'pointer', fontSize: 12, marginLeft: 'auto' }}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={c.panel}>
        <h2 style={c.h2}>Add a build</h2>
        <p style={c.sub}>Point it at any URL — an external app/site, or a page in this dashboard.</p>
        <form onSubmit={onAdd}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div><label style={c.label}>Title</label><input style={c.input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Remote Console" /></div>
            <div><label style={c.label}>Link (URL)</label><input style={c.input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… or /console" /></div>
            <div style={{ gridColumn: '1/-1' }}><label style={c.label}>Description</label><input style={c.input} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this build does" /></div>
          </div>
          <div style={{ marginTop: 16 }}>
            <button type="submit" style={{ ...c.primary, opacity: busy ? 0.5 : 1 }} disabled={busy}>Add to workshop</button>
          </div>
        </form>
      </section>
    </>
  )
}
