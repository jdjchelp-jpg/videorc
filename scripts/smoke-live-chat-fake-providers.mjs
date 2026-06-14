import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

import { connectBackend, request } from './smoke-recording-session.mjs'

// Live-chat smoke with the fake connector (slice 10): drives the LiveChatCoordinator end to
// end over the real websocket protocol without any platform OAuth. Proves start → messages →
// de-dupe → diagnostics → clear → stop, plus the capability/X-gate surface. The real YouTube/
// Twitch OAuth live smokes and the gated X smoke are documented in
// docs/live-chat-live-smoke-checklist.md (they need live accounts + a real stream).

const repoRoot = resolve(import.meta.dirname, '..')
const timeoutMs = Number(process.env.VIDEORC_SMOKE_TIMEOUT_MS ?? 90000)

let appProcess
let stopping = false

try {
  const connection = await launchAndReadConnection()
  const ws = await connectBackend(connection, timeoutMs)
  const messages = collectMessages(ws)
  try {
    // Capability surface: every native platform present; X is unsupported (pending API access).
    const capability = await request(ws, timeoutMs, 'liveChat.capability', {})
    const platforms = capability.map((entry) => entry.platform)
    for (const platform of ['youtube', 'twitch', 'x']) {
      if (!platforms.includes(platform)) {
        throw new Error(`liveChat.capability missing ${platform}: ${JSON.stringify(platforms)}`)
      }
    }
    const x = capability.find((entry) => entry.platform === 'x')
    if (x.state !== 'unsupported' || x.chatReadAvailable) {
      throw new Error(`X chat should be unsupported, got ${JSON.stringify(x)}`)
    }

    const readiness = await request(ws, timeoutMs, 'liveChat.xCommentsReadiness', {})
    if (readiness.available || readiness.evidenceChecklist.length < 1) {
      throw new Error(`X comments must stay gated with evidence: ${JSON.stringify(readiness)}`)
    }

    // Start a fake YouTube chat session: 5 messages + one re-sent id to exercise de-dupe.
    const sessionId = `smoke-live-chat-${Date.now()}`
    await request(ws, timeoutMs, 'liveChat.start', {
      sessionId,
      fake: { platform: 'youtube', count: 5, intervalMs: 40, includeDuplicate: true }
    })

    await waitFor(() => messages.length >= 5, timeoutMs, 'fake chat messages')

    const diagnostics = await request(ws, timeoutMs, 'liveChat.diagnostics', {})
    if (diagnostics.messagesReceived < 5) {
      throw new Error(`Expected >=5 messages received, got ${diagnostics.messagesReceived}`)
    }
    if (diagnostics.duplicatesSkipped < 1) {
      throw new Error(
        `Expected the duplicate id to be skipped, got ${diagnostics.duplicatesSkipped}`
      )
    }

    // The streamer can read the comments from the snapshot — no platform dashboard needed.
    const status = await request(ws, timeoutMs, 'liveChat.status', {})
    if (status.messages.length < 5 || status.sessionId !== sessionId) {
      throw new Error(
        `liveChat.status did not expose the session feed: ${JSON.stringify({
          sessionId: status.sessionId,
          count: status.messages.length
        })}`
      )
    }
    if (
      !status.messages.every(
        (message) => message.platform === 'youtube' && message.id.startsWith('youtube:')
      )
    ) {
      throw new Error('Fake feed contained unexpected message shapes.')
    }

    // Clearing the local view empties the feed without ending the session.
    const cleared = await request(ws, timeoutMs, 'liveChat.clearLocal', {})
    if (cleared.messages.length !== 0) {
      throw new Error(`liveChat.clearLocal did not empty the feed: ${cleared.messages.length}`)
    }

    const stopped = await request(ws, timeoutMs, 'liveChat.stop', {})
    if (stopped.sessionId) {
      throw new Error(
        `liveChat.stop should clear the active session: ${JSON.stringify(stopped.sessionId)}`
      )
    }

    console.log(
      `Live-chat fake-provider smoke OK - ${diagnostics.messagesReceived} messages, ` +
        `${diagnostics.duplicatesSkipped} duplicate(s) skipped, X gated as "${x.message}".`
    )
  } finally {
    ws.close()
  }
} finally {
  await stopApp()
}

function collectMessages(ws) {
  const messages = []
  ws.addEventListener('message', (event) => {
    let parsed
    try {
      parsed = JSON.parse(event.data)
    } catch {
      return
    }
    if (parsed.event === 'liveChat.message') {
      messages.push(parsed.payload)
    }
  })
  return messages
}

function waitFor(predicate, deadlineMs, label) {
  return new Promise((resolveWait, rejectWait) => {
    const startedAt = Date.now()
    const tick = () => {
      if (predicate()) {
        resolveWait()
        return
      }
      if (Date.now() - startedAt > deadlineMs) {
        rejectWait(new Error(`Timed out waiting for ${label}.`))
        return
      }
      setTimeout(tick, 50)
    }
    tick()
  })
}

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
        VIDEORC_DISABLE_BACKEND_REAP: process.env.VIDEORC_DISABLE_BACKEND_REAP ?? '1',
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
      rejectConnection(
        new Error(
          `Dev app exited before the live-chat smoke completed: code=${code} signal=${signal}`
        )
      )
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
