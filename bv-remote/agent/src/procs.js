// Running-process control via Windows' built-in tasklist / taskkill.
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'

const execFileP = promisify(execFile)

// List running processes, biggest memory first (that's what an operator cares about).
export async function listProcs() {
  const { stdout } = await execFileP('tasklist', ['/fo', 'csv', '/nh'], {
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  })
  const rows = stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      // CSV columns: "name","pid","session","session#","memusage"
      const cols = (line.match(/"([^"]*)"/g) || []).map((s) => s.slice(1, -1))
      const memKB = parseInt((cols[4] || '').replace(/[^\d]/g, ''), 10) || 0
      return { name: cols[0] || '', pid: parseInt(cols[1], 10) || 0, memKB }
    })
    .filter((p) => p.pid)
  rows.sort((a, b) => b.memKB - a.memKB)
  return rows.slice(0, 300)
}

// Force-kill a process by pid. Throws (→ ok:false upstream) for protected ones.
export async function killProc(pid) {
  const n = parseInt(pid, 10)
  if (!n) throw new Error('bad pid')
  await execFileP('taskkill', ['/PID', String(n), '/F'], { windowsHide: true })
  return { killed: n }
}
