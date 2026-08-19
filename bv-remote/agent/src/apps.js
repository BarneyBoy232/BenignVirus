// Installed-app discovery + launch. We read the Start-Menu shortcuts (.lnk), which
// is exactly what the user sees in their Start menu and is directly launchable.
import fs from 'node:fs/promises'
import path from 'node:path'
import { shell } from 'electron'

const START_DIRS = [
  path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
].filter(Boolean)

async function walk(dir, out, depth = 0) {
  if (depth > 6) return
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) await walk(full, out, depth + 1)
    else if (e.isFile() && e.name.toLowerCase().endsWith('.lnk')) {
      out.push({ name: e.name.replace(/\.lnk$/i, ''), path: full })
    }
  }
}

// Every installed app we can launch, de-duplicated by name, alphabetical.
export async function listApps() {
  const found = []
  for (const d of START_DIRS) await walk(d, found)
  found.sort((a, b) => a.name.localeCompare(b.name))
  const seen = new Set()
  const uniq = []
  for (const a of found) {
    if (seen.has(a.name)) continue
    seen.add(a.name)
    uniq.push(a)
  }
  return uniq
}

// Launch an app by its shortcut path. shell.openPath runs the .lnk with its default
// handler — no shell string to inject into.
export async function launchApp(p) {
  if (!p || typeof p !== 'string') throw new Error('bad path')
  const err = await shell.openPath(p)
  if (err) throw new Error(err)
  return { launched: path.basename(p, '.lnk') }
}
