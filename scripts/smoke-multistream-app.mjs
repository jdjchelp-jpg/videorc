import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { connectBackend, request } from './smoke-recording-session.mjs'

// End-to-end proof of the multi-platform `tee` fan-out (M4). Stands up one local
// FFmpeg RTMP listener per destination, drives a real record + simulcast session,
// and asserts bytes arrive at *every* target while the local MKV still finalizes.
// No Docker or external services: the listeners are plain `ffmpeg -listen 1`.

const repoRoot = resolve(import.meta.dirname, '..')
const outputDirectory = resolve(
  process.env.VIDEORC_SMOKE_OUTPUT_DIR ?? join(tmpdir(), `videorc-multistream-smoke-${Date.now()}`)
)
const ffmpegPath = process.env.VIDEORC_SMOKE_FFMPEG_PATH ?? 'ffmpeg'
const timeoutMs = Number(process.env.VIDEORC_SMOKE_TIMEOUT_MS ?? 90000)
const targetCount = Math.min(4, Math.max(1, Number(process.env.VIDEORC_SMOKE_TARGETS ?? 3)))
const basePort = Number(process.env.VIDEORC_SMOKE_RTMP_PORT ?? 11935)
const streamMs = Number(process.env.VIDEORC_SMOKE_STREAM_MS ?? 5000)
const listenerBindMs = Number(process.env.VIDEORC_SMOKE_LISTENER_BIND_MS ?? 2500)

const PLATFORMS = [
  { id: 'youtube', label: 'YouTube' },
  { id: 'twitch', label: 'Twitch' },
  { id: 'x', label: 'X / Twitter' },
  { id: 'custom', label: 'Custom RTMP' }
]

const targets = Array.from({ length: targetCount }, (_, index) => {
  const port = basePort + index
  const platform = PLATFORMS[index % PLATFORMS.length]
  const streamKey = `smoke${index}`
  return {
    id: platform.id,
    platform: platform.id,
    label: platform.label,
    port,
    streamKey,
    serverUrl: `rtmp://127.0.0.1:${port}/live`,
    listenUrl: `rtmp://127.0.0.1:${port}/live/${streamKey}`,
    recvPath: join(outputDirectory, `recv-${port}.flv`)
  }
})

mkdirSync(outputDirectory, { recursive: true })

let appProcess
let stopping = false
const listeners = []

try {
  // 1. Launch the dev app + backend first so the RTMP listeners only idle briefly
  //    before the publisher connects (a long idle can trip FFmpeg's accept timeout).
  const connection = await launchAndReadConnection()

  // 2. Stand up one local RTMP listener per target.
  for (const target of targets) {
    listeners.push(spawnListener(target))
  }
  console.log(
    `Started ${targets.length} local RTMP listener(s): ${targets
      .map((t) => `${t.label} → :${t.port}`)
      .join(', ')}`
  )
  await sleep(listenerBindMs) // give the listeners time to bind their ports

  // 3. Drive a real session that records + streams to every local target at once.
  const ws = await connectBackend(connection, timeoutMs)
  try {
    const health = await request(ws, timeoutMs, 'health.ping', { ffmpegPath })
    if (!health?.ffmpeg?.available) {
      throw new Error(health?.ffmpeg?.message ?? 'FFmpeg is unavailable for the multistream smoke.')
    }
    console.log(`Multistream smoke using FFmpeg: ${ffmpegPath}`)

    const started = await request(ws, timeoutMs, 'session.start', multistreamParams())
    if (!['recording', 'streaming'].includes(started.state)) {
      throw new Error(`Expected recording/streaming state after start, got ${started.state}.`)
    }
    console.log(
      `Session started (${started.state}); fanning one encode out to ${targets.length} target(s).`
    )
    console.log(`  stream targets: ${started.streamUrl ?? 'n/a'}`)

    await sleep(streamMs)

    const stopped = await request(ws, timeoutMs, 'session.stop')
    const outputPath = stopped.outputPath ?? started.outputPath
    await sleep(2000) // let listeners flush + finalize their FLV after the publisher disconnects

    verifyResults(outputPath)
  } finally {
    ws.close()
  }
} finally {
  for (const listener of listeners) {
    await stopListener(listener)
  }
  await stopApp()
}

function verifyResults(outputPath) {
  const failures = []
  for (const target of targets) {
    const size = existsSync(target.recvPath) ? statSync(target.recvPath).size : 0
    if (size > 0) {
      console.log(`  ✓ ${target.label} (:${target.port}) received ${size} bytes`)
    } else {
      console.log(`  ✗ ${target.label} (:${target.port}) received no bytes`)
      failures.push(`${target.label} received no bytes`)
    }
  }

  const mkvSize = outputPath && existsSync(outputPath) ? statSync(outputPath).size : 0
  if (mkvSize > 0) {
    console.log(`  ✓ Local MKV finalized: ${outputPath} (${mkvSize} bytes)`)
  } else {
    console.log(`  ✗ Local MKV missing/empty: ${outputPath ?? 'no path'}`)
    failures.push('Local MKV did not finalize')
  }

  if (failures.length > 0) {
    throw new Error(`Multistream smoke failed: ${failures.join('; ')}`)
  }

  console.log(
    `Multistream smoke OK — one encode fanned out to all ${targets.length} RTMP target(s) and the MKV finalized.`
  )
}

function multistreamParams() {
  const timestamp = '2026-01-01T00:00:00.000Z'
  return {
    sources: { testPattern: true },
    layout: {
      layoutPreset: 'screen-camera',
      cameraTransformMode: 'preset',
      cameraTransform: null,
      cameraCorner: 'bottom-right',
      cameraSize: 'medium',
      cameraShape: 'rectangle',
      cameraMargin: 32,
      cameraFit: 'fill',
      cameraMirror: false,
      cameraZoom: 100,
      cameraOffsetX: 0,
      cameraOffsetY: 0,
      sideBySideSplit: '70-30',
      sideBySideCameraSide: 'right'
    },
    output: {
      recordEnabled: true,
      streamEnabled: true,
      outputDirectory,
      ffmpegPath,
      video: { preset: 'custom', width: 640, height: 360, fps: 30, bitrateKbps: 2000 },
      // Legacy single-RTMP bridge fields. Ignored when `streaming` is present, but
      // kept valid so the fallback path never chokes on empty credentials.
      rtmp: { preset: 'custom', serverUrl: targets[0].serverUrl, streamKey: targets[0].streamKey }
    },
    streaming: {
      enabled: true,
      mode: targets.length > 1 ? 'multi' : 'single',
      targets: targets.map((target) => ({
        id: target.id,
        platform: target.platform,
        label: target.label,
        enabled: true,
        serverUrl: target.serverUrl,
        urlMode: 'server-and-key',
        streamKey: target.streamKey,
        streamKeyPresent: true,
        authMode: 'manual-rtmp',
        createdAt: timestamp,
        updatedAt: timestamp
      })),
      defaultOutputPreset: 'tutorial-1080p30',
      defaultBitrateKbps: 6000,
      enabledTargetIds: targets.map((target) => target.id)
    }
  }
}

function spawnListener(target) {
  const proc = spawn(
    ffmpegPath,
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-listen',
      '1',
      '-i',
      target.listenUrl,
      '-c',
      'copy',
      '-f',
      'flv',
      target.recvPath
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  )
  proc.stderr.setEncoding('utf8')
  proc.stderr.on('data', (text) => {
    if (stopping) {
      return
    }
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) {
        console.error(`[listener :${target.port}] ${line}`)
      }
    }
  })
  return proc
}

function stopListener(proc) {
  return new Promise((resolveStop) => {
    if (!proc?.pid || proc.killed) {
      resolveStop()
      return
    }
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL')
      } catch {
        // already gone
      }
      resolveStop()
    }, 2000)
    proc.once('exit', () => {
      clearTimeout(timer)
      resolveStop()
    })
    try {
      proc.kill('SIGTERM')
    } catch {
      clearTimeout(timer)
      resolveStop()
    }
  })
}

// --- dev app lifecycle (mirrors scripts/smoke-dev-app.mjs) ---

function launchAndReadConnection() {
  return new Promise((resolveConnection, rejectConnection) => {
    const timer = setTimeout(() => {
      rejectConnection(new Error(`Timed out waiting for dev backend READY after ${timeoutMs}ms.`))
    }, timeoutMs)

    appProcess = spawn('pnpm', ['dev'], {
      cwd: repoRoot,
      detached: true,
      env: {
        ...process.env,
        VIDEORC_SMOKE_PRINT_BACKEND_READY: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    appProcess.stdout.setEncoding('utf8')
    appProcess.stderr.setEncoding('utf8')
    appProcess.stdout.on('data', (text) => handleAppOutput(text, resolveConnection, timer))
    appProcess.stderr.on('data', (text) => handleAppOutput(text, resolveConnection, timer))
    appProcess.on('error', (error) => {
      clearTimeout(timer)
      rejectConnection(error)
    })
    appProcess.on('exit', (code, signal) => {
      clearTimeout(timer)
      rejectConnection(new Error(`Dev app exited before smoke test completed: code=${code} signal=${signal}`))
    })
  })
}

function handleAppOutput(text, resolveConnection, timer) {
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() && !stopping) {
      console.log(line)
    }

    const marker = '[smoke] backend-ready '
    const index = line.indexOf(marker)
    if (index === -1) {
      continue
    }

    clearTimeout(timer)
    resolveConnection(JSON.parse(line.slice(index + marker.length)))
  }
}

function stopApp() {
  return new Promise((resolveStop) => {
    if (!appProcess?.pid || appProcess.killed) {
      resolveStop()
      return
    }

    const timer = setTimeout(() => {
      killApp('SIGKILL')
      resolveStop()
    }, 5000)

    stopping = true
    appProcess.once('exit', () => {
      clearTimeout(timer)
      resolveStop()
    })
    killApp('SIGTERM')
  })
}

function killApp(signal) {
  if (!appProcess?.pid) {
    return
  }

  try {
    process.kill(-appProcess.pid, signal)
  } catch {
    appProcess.kill(signal)
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}
