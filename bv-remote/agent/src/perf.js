// A performance snapshot: system CPU/RAM plus THIS agent's own cost — which answers
// "how much is the remote tool tanking their machine?" (the live streaming delta
// lands in Phase 3, over the video session).
import os from 'node:os'

function cpuTimes() {
  const cpus = os.cpus()
  let idle = 0
  let total = 0
  for (const { times } of cpus) {
    idle += times.idle
    for (const k in times) total += times[k]
  }
  return { idle, total }
}

export async function snapshot() {
  const cores = os.cpus().length

  // Sample system CPU + this process's CPU over the same ~400ms window.
  const sysA = cpuTimes()
  const procA = process.cpuUsage()
  const t0 = performance.now()
  await new Promise((r) => setTimeout(r, 400))
  const sysB = cpuTimes()
  const procDelta = process.cpuUsage(procA) // microseconds of CPU time used
  const elapsedMs = performance.now() - t0

  const idle = sysB.idle - sysA.idle
  const total = sysB.total - sysA.total
  const cpuPct = total > 0 ? Math.round((1 - idle / total) * 100) : 0

  // Agent CPU% across all cores: cpu-time used / (wall time × cores).
  const agentCpuUs = procDelta.user + procDelta.system
  const denom = Math.max(1, elapsedMs) * Math.max(1, cores)
  const agentCpuPct = Math.round((agentCpuUs / 1000 / denom) * 100)

  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = totalMem - freeMem

  return {
    cpuPct,
    cores,
    memUsedGB: +(usedMem / 1e9).toFixed(2),
    memTotalGB: +(totalMem / 1e9).toFixed(2),
    memPct: Math.round((usedMem / totalMem) * 100),
    agentCpuPct: Math.max(0, agentCpuPct),
    agentMemMB: Math.round(process.memoryUsage().rss / 1e6),
  }
}
