// Shared dev-app launcher for harnesses that need a real backend connection.
//
// Spawns `pnpm dev`, parses the `[smoke] <marker> {json}` handshake lines the main
// process prints, and resolves once every required marker has been seen. Factored out
// of the per-smoke launch boilerplate so the real-source baseline harness (and future
// honest-gate harnesses) reuse one battle-tested launch/teardown path.
//
// Harnesses default to not reaping globally-recorded owner backends. Product
// launches and lifecycle smokes can pass VIDEORC_DISABLE_BACKEND_REAP=0.

import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

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
  onLine
} = {}) {
  return new Promise((resolveLaunch, rejectLaunch) => {
    const connections = {}
    let settled = false
    let stopping = false
    const userDataDir =
      env.VIDEORC_USER_DATA_DIR ??
      process.env.VIDEORC_USER_DATA_DIR ??
      mkdtempSync(join(tmpdir(), 'videorc-smoke-user-data-'))

    const child = spawn('pnpm', ['dev'], {
      cwd: repoRoot,
      detached: true,
      env: {
        ...process.env,
        VIDEORC_SMOKE_PRINT_BACKEND_READY: '1',
        VIDEORC_DISABLE_BACKEND_REAP: process.env.VIDEORC_DISABLE_BACKEND_REAP ?? '1',
        VIDEORC_USER_DATA_DIR: userDataDir,
        ...env
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const stop = () => stopProcess(child, () => (stopping = true))

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      void stop()
      rejectLaunch(
        new Error(`Timed out waiting for [${requiredMarkers.join(', ')}] after ${timeoutMs}ms.`)
      )
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
      rejectLaunch(
        new Error(`Dev app exited before handshake completed: code=${code} signal=${signal}`)
      )
    })
  })
}

/** SIGTERM the process group, escalating to SIGKILL after a grace period. */
export async function stopProcess(child, beforeStop) {
  if (!child?.pid) return

  const pid = child.pid
  beforeStop?.()
  signalProcessGroup(pid, child, 'SIGTERM')
  await waitForChildExit(child, 5000)

  if (processGroupExists(pid)) {
    signalProcessGroup(pid, child, 'SIGTERM')
    await waitForProcessGroupExit(pid, 500)
  }
  if (processGroupExists(pid)) {
    signalProcessGroup(pid, child, 'SIGKILL')
    await waitForProcessGroupExit(pid, 1000)
  }
}

function signalProcessGroup(pid, child, sig) {
  try {
    process.kill(-pid, sig)
  } catch {
    try {
      child?.kill(sig)
    } catch {
      // Nothing left to signal.
    }
  }
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolveWait) => {
    const timer = setTimeout(resolveWait, timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolveWait()
    })
  })
}

function waitForProcessGroupExit(pid, timeoutMs) {
  const startedAt = Date.now()
  return new Promise((resolveWait) => {
    const poll = () => {
      if (!processGroupExists(pid) || Date.now() - startedAt >= timeoutMs) {
        resolveWait()
        return
      }
      setTimeout(poll, 50)
    }
    poll()
  })
}

function processGroupExists(pid) {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}
