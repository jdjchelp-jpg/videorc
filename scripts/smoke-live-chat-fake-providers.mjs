import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

import { smokeAppEnv, stopProcess } from './lib/app-launcher.mjs'
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

    // Send fan-out honesty (Comments upgrade S4/S5): the fake provider has no
    // sender, so a send must report per-platform results and NEVER claim
    // success — the no-destination case is stated, not silent.
    const sendResults = await request(ws, timeoutMs, 'liveChat.send', { text: 'hello chat' })
    if (!Array.isArray(sendResults) || sendResults.length === 0) {
      throw new Error(
        `liveChat.send returned no per-platform results: ${JSON.stringify(sendResults)}`
      )
    }
    if (sendResults.some((result) => result.status === 'sent')) {
      throw new Error(
        `liveChat.send claimed success with no real sender: ${JSON.stringify(sendResults)}`
      )
    }
    let sendRejected = false
    try {
      await request(ws, timeoutMs, 'liveChat.send', { text: '' })
    } catch {
      sendRejected = true
    }
    if (!sendRejected) {
      throw new Error('liveChat.send accepted an empty message.')
    }

    // Comment-highlight overlay round-trip (Comments upgrade S2/S3): install a
    // tiny PNG into the DEDICATED highlight slot, then clear it.
    const onePixelPng =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    const highlightSet = await request(ws, timeoutMs, 'comments.highlight.set', {
      pngBase64: onePixelPng,
      position: 'top'
    })
    if (!highlightSet.active || highlightSet.width !== 1) {
      throw new Error(`comments.highlight.set did not install: ${JSON.stringify(highlightSet)}`)
    }
    const highlightCleared = await request(ws, timeoutMs, 'comments.highlight.clear', {})
    if (highlightCleared.active) {
      throw new Error(
        `comments.highlight.clear left the overlay active: ${JSON.stringify(highlightCleared)}`
      )
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
      env: smokeAppEnv({
        VIDEORC_SMOKE_PRINT_BACKEND_READY: '1'
      }),
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

async function stopApp() {
  if (!appProcess?.pid || appProcess.killed) {
    return
  }
  stopping = true
  await stopProcess(appProcess)
}
