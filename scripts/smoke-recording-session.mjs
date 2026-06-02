import { existsSync, mkdirSync, statSync } from 'node:fs'

export const LAYOUT_PRESET_SCENARIOS = [
  { preset: 'screen-camera', label: 'Screen + camera' },
  { preset: 'screen-only', label: 'Screen only' },
  { preset: 'camera-only', label: 'Camera only' },
  { preset: 'side-by-side', label: 'Side-by-side' }
]

export async function runBackendRecordingSmoke({
  connection,
  ffmpegPath,
  outputDirectory,
  timeoutMs = 45000,
  recordingMs = 1000,
  label = 'App',
  onHealth,
  scenarios = LAYOUT_PRESET_SCENARIOS
}) {
  mkdirSync(outputDirectory, { recursive: true })

  let ws
  try {
    ws = await connectBackend(connection, timeoutMs)
    const health = await request(ws, timeoutMs, 'health.ping', { ffmpegPath })
    if (!health?.ffmpeg?.available) {
      throw new Error(health?.ffmpeg?.message ?? 'FFmpeg is unavailable for smoke recording.')
    }

    await onHealth?.({ health, ffmpegPath })
    console.log(`${label} smoke using FFmpeg: ${ffmpegPath}`)

    // Drive every layout preset through real FFmpeg with the test pattern so each
    // composed filtergraph (overlay, screen-only, camera-only, side-by-side) is
    // validated end to end and the recording finalizes.
    const results = []
    for (const scenario of scenarios) {
      results.push(
        await recordScenario({ ws, timeoutMs, recordingMs, label, outputDirectory, ffmpegPath, scenario })
      )
    }
    return results
  } finally {
    ws?.close()
  }
}

async function recordScenario({ ws, timeoutMs, recordingMs, label, outputDirectory, ffmpegPath, scenario }) {
  const started = await request(
    ws,
    timeoutMs,
    'session.start',
    sessionParams({ outputDirectory, ffmpegPath, preset: scenario.preset })
  )
  if (!['recording', 'streaming'].includes(started.state)) {
    throw new Error(`[${scenario.label}] Expected recording state after start, got ${started.state}.`)
  }

  await sleep(recordingMs)

  const stopped = await request(ws, timeoutMs, 'session.stop')
  const outputPath = stopped.outputPath ?? started.outputPath
  if (!outputPath || !existsSync(outputPath)) {
    throw new Error(`[${scenario.label}] Recording output was not created: ${outputPath ?? 'missing path'}`)
  }

  const size = statSync(outputPath).size
  if (size <= 0) {
    throw new Error(`[${scenario.label}] Recording output is empty: ${outputPath}`)
  }

  console.log(`${label} smoke [${scenario.label}] recording created: ${outputPath} (${size} bytes)`)
  return { preset: scenario.preset, outputPath, size }
}

export function connectBackend(connection, timeoutMs) {
  return new Promise((resolveConnection, rejectConnection) => {
    const url = `ws://${connection.host}:${connection.port}/ws?token=${encodeURIComponent(connection.token)}`
    let ws
    const timer = setTimeout(() => {
      ws?.close()
      rejectConnection(new Error(`Timed out connecting to ${url}.`))
    }, timeoutMs)
    ws = new WebSocket(url)
    ws.addEventListener('open', () => {
      clearTimeout(timer)
      resolveConnection(ws)
    }, { once: true })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      rejectConnection(new Error(`Could not connect to ${url}`))
    }, {
      once: true
    })
  })
}

export function request(ws, timeoutMs, method, params) {
  const id = `smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`
  return new Promise((resolveRequest, rejectRequest) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage)
      rejectRequest(new Error(`Timed out waiting for ${method}.`))
    }, timeoutMs)

    const onMessage = (event) => {
      let message
      try {
        message = JSON.parse(event.data)
      } catch (error) {
        clearTimeout(timer)
        ws.removeEventListener('message', onMessage)
        rejectRequest(error)
        return
      }
      if (message.id !== id) {
        return
      }

      clearTimeout(timer)
      ws.removeEventListener('message', onMessage)
      if (message.ok) {
        resolveRequest(message.payload)
      } else {
        rejectRequest(new Error(message.error?.message ?? `${method} failed.`))
      }
    }

    ws.addEventListener('message', onMessage)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

function sessionParams({ outputDirectory, ffmpegPath, preset = 'screen-camera' }) {
  return {
    sources: {
      testPattern: true
    },
    layout: {
      layoutPreset: preset,
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
      streamEnabled: false,
      outputDirectory,
      ffmpegPath,
      video: {
        preset: 'custom',
        width: 640,
        height: 360,
        fps: 30,
        bitrateKbps: 2000
      },
      rtmp: {
        preset: 'custom',
        serverUrl: '',
        streamKey: ''
      }
    }
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}
