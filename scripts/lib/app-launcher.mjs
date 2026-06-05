// Shared dev-app launcher for harnesses that need a real backend connection.
//
// Spawns `pnpm dev`, parses the `[smoke] <marker> {json}` handshake lines the main
// process prints, and resolves once every required marker has been seen. Factored out
// of the per-smoke launch boilerplate so the real-source baseline harness (and future
// honest-gate harnesses) reuse one battle-tested launch/teardown path.

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

export const repoRoot = resolve(import.meta.dirname, '..', '..')

const MARKER_PREFIX = '[smoke] '

/**
 * Launch the dev app and resolve with the parsed handshake connections.
 *
 * @param {object} options
 * @param {Record<string,string>} [options.env] - extra env vars for the child.
 * @param {number} [options.timeoutMs]
 * @param {string[]} [options.requiredMarkers] - marker names to wait for (without the
 *   `[smoke] ` prefix), e.g. ['backend-ready'].
 * @param {(line:string)=>void} [options.onLine] - called for every stdout/stderr line.
 * @returns {Promise<{connections:Record<string,object>, process:import('node:child_process').ChildProcess, stop:()=>Promise<void>}>}
 */
export function launchDevApp({
  env = {},
  timeoutMs = 120000,
  requiredMarkers = ['backend-ready'],
  onLine,
} = {}) {
  return new Promise((resolveLaunch, rejectLaunch) => {
    const connections = {}
    let settled = false
    let stopping = false

    const child = spawn('pnpm', ['dev'], {
      cwd: repoRoot,
      detached: true,
      env: { ...process.env, VIDEORC_SMOKE_PRINT_BACKEND_READY: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const stop = () => stopProcess(child, () => (stopping = true))

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      void stop()
      rejectLaunch(new Error(`Timed out waiting for [${requiredMarkers.join(', ')}] after ${timeoutMs}ms.`))
    }, timeoutMs)

    const settleIfReady = () => {
      if (settled) return
      if (requiredMarkers.every((marker) => connections[marker])) {
        settled = true
        clearTimeout(timer)
        resolveLaunch({ connections, process: child, stop })
      }
    }

    const handle = (text) => {
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue
        if (onLine && !stopping) onLine(line)
        const idx = line.indexOf(MARKER_PREFIX)
        if (idx === -1) continue
        const rest = line.slice(idx + MARKER_PREFIX.length)
        const spaceIdx = rest.indexOf(' ')
        if (spaceIdx === -1) continue
        const marker = rest.slice(0, spaceIdx)
        if (!requiredMarkers.includes(marker)) continue
        try {
          connections[marker] = JSON.parse(rest.slice(spaceIdx + 1))
          settleIfReady()
        } catch {
          // A non-JSON tail for a known marker: ignore and keep waiting.
        }
      }
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', handle)
    child.stderr.on('data', handle)
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      rejectLaunch(error)
    })
    child.on('exit', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      rejectLaunch(new Error(`Dev app exited before handshake completed: code=${code} signal=${signal}`))
    })
  })
}

/** SIGTERM the process group, escalating to SIGKILL after a grace period. */
export function stopProcess(child, beforeStop) {
  return new Promise((resolveStop) => {
    if (!child?.pid || child.killed) {
      resolveStop()
      return
    }
    beforeStop?.()
    const timer = setTimeout(() => {
      signal(child, 'SIGKILL')
      resolveStop()
    }, 5000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolveStop()
    })
    signal(child, 'SIGTERM')
  })
}

function signal(child, sig) {
  if (!child?.pid) return
  try {
    process.kill(-child.pid, sig)
  } catch {
    child.kill(sig)
  }
}
