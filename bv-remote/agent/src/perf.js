// A performance snapshot: system CPU/RAM plus THIS agent's own cost — which answers
// "how much is the remote tool tanking their machine?".
//
// The agent's own cost is summed across EVERY process Electron runs for it — the
// main process, the hidden screen-capture window, the GPU process — because the
// streaming happens in that capture window, not the main process. Measuring only
// the main process (as before) reported a fraction of the real cost.
import os from 'node:os'
import { app } from 'electron'

// appCost returns this whole app's CPU share of the machine and its total memory,
// by summing Electron's per-process metrics.
function appCost(cores) {
  try {
    let cpu = 0
    let memKB = 0
    for (const m of app.getAppMetrics()) {
      cpu += (m.cpu && m.cpu.percentCPUUsage) || 0 // percent of ONE core
      memKB += (m.memory && m.memory.workingSetSize) || 0
    }
    return {
      cpuPct: Math.max(0, Math.round(cpu / Math.max(1, cores))), // share of all cores
      memMB: Math.round(memKB / 1024),
    }
  } catch {
    return { cpuPct: 0, memMB: 0 }
  }
}

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

  const cost = appCost(cores)

  return {
    cpuPct,
    cores,
    memUsedGB: +(usedMem / 1e9).toFixed(2),
    memTotalGB: +(totalMem / 1e9).toFixed(2),
    memPct: Math.round((usedMem / totalMem) * 100),
    // The whole app's cost — main process plus the capture window and GPU. These
    // are what the console shows as "what this app is taking".
    agentCpuPct: cost.cpuPct,
    agentMemMB: cost.memMB,
    agentMemPct: totalMem > 0 ? Math.round((cost.memMB * 1e6) / totalMem * 100) : 0,
    // Kept for reference: the main process alone, the old number.
    mainCpuPct: Math.max(0, agentCpuPct),
  }
}
