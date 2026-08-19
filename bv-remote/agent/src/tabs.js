// Chrome tab control via the Chrome DevTools Protocol HTTP endpoints on port 9222.
// Chrome only exposes these if it was started with --remote-debugging-port=9222, so
// listTabs reports whether that's the case and enableTabs (re)starts Chrome into it.
import { promisify } from 'node:util'
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const execFileP = promisify(execFile)
const PORT = 9222

const CHROME_CANDIDATES = [
  path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(process.env['LOCALAPPDATA'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
]

function chromePath() {
  return CHROME_CANDIDATES.find((p) => {
    try { return fs.existsSync(p) } catch { return false }
  })
}

async function cdp(pathname, method = 'GET') {
  const res = await fetch(`http://127.0.0.1:${PORT}${pathname}`, { method })
  if (!res.ok) throw new Error(`CDP ${pathname} -> ${res.status}`)
  const ct = res.headers.get('content-type') || ''
  return ct.includes('json') ? res.json() : res.text()
}

// List open tabs. If Chrome isn't in debug mode, say so (needsEnable) instead of
// erroring. We retry once so a transient blip doesn't get misreported as "needs a
// restart" — the enable path force-restarts the user's Chrome, so a false positive
// is costly.
export async function listTabs() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const targets = await cdp('/json')
      const tabs = targets
        .filter((t) => t.type === 'page' && !String(t.url).startsWith('devtools://'))
        .map((t) => ({ id: t.id, title: t.title || t.url, url: t.url }))
      return { debug: true, tabs }
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 300))
    }
  }
  return { debug: false, needsEnable: true, tabs: [] }
}

export async function openTab(url) {
  const u = /^[a-z]+:\/\//i.test(url) ? url : 'https://' + url
  // Chrome's /json/new expects the RAW url as the query (some builds open a
  // percent-encoded value literally). Recent Chrome requires PUT; older accepts
  // GET — try PUT then GET.
  try {
    await cdp('/json/new?' + u, 'PUT')
  } catch {
    await cdp('/json/new?' + u, 'GET')
  }
  return { opened: u }
}

export async function closeTab(id) {
  if (!id) throw new Error('bad tab id')
  await cdp('/json/close/' + id, 'GET')
  return { closed: id }
}

// Restart Chrome with the debug port so tabs become controllable. This closes the
// user's Chrome and reopens it restoring the last session — a one-off restart.
export async function enableTabs() {
  const cp = chromePath()
  if (!cp) throw new Error('Chrome not found in the usual locations')
  await execFileP('taskkill', ['/IM', 'chrome.exe', '/F'], { windowsHide: true }).catch(() => {})
  await new Promise((r) => setTimeout(r, 900))
  spawn(cp, [`--remote-debugging-port=${PORT}`, '--restore-last-session'], {
    detached: true,
    stdio: 'ignore',
  }).unref()
  // Give Chrome a moment to open the debug port.
  await new Promise((r) => setTimeout(r, 1800))
  return { enabled: true }
}
