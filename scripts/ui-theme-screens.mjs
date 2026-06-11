// Both-theme screenshot sweep for the glass redesign slices.
//
// Launches an isolated instance (fresh profile — proves the dark default),
// captures the requested tabs in dark, flips the theme to light via CDP
// (localStorage + reload, the same mechanism the toggle persists through),
// and captures again. PNGs land in VIDEORC_SMOKE_OUTPUT_DIR (/tmp).
//
// Usage: node scripts/ui-theme-screens.mjs [tab ...]   (default: studio streaming)

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request as httpRequest } from 'node:http'

import { launchDevApp } from './lib/app-launcher.mjs'

const tabs = process.argv.slice(2).length ? process.argv.slice(2) : ['studio', 'streaming']
const timeoutMs = Number(process.env.VIDEORC_PROBE_TIMEOUT_MS ?? 180000)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function smokeCommand(smoke, command, params = {}) {
  const body = JSON.stringify({ command, params })
  return new Promise((resolveCmd, rejectCmd) => {
    const req = httpRequest(
      {
        hostname: smoke.host,
        port: smoke.port,
        path: '/command',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      },
      (res) => {
        res.setEncoding('utf8')
        let text = ''
        res.on('data', (c) => (text += c))
        res.on('end', () => {
          try {
            const payload = JSON.parse(text)
            if (payload.error) rejectCmd(new Error(`${command} -> ${payload.error}`))
            else resolveCmd(payload.result ?? payload)
          } catch {
            rejectCmd(new Error(`${command} -> invalid JSON: ${text.slice(0, 200)}`))
          }
        })
      }
    )
    req.on('error', rejectCmd)
    req.write(body)
    req.end()
  })
}

async function smokeCommandRetry(smoke, command, params = {}) {
  const deadline = Date.now() + 30000
  let last
  while (Date.now() < deadline) {
    try {
      return await smokeCommand(smoke, command, params)
    } catch (e) {
      last = e
      const m = String(e?.message ?? e)
      if (!m.includes('Main window is not ready') && !m.includes('Could not find tab')) throw e
      await sleep(250)
    }
  }
  throw last
}

function fetchJson(url) {
  return new Promise((resolveFetch, rejectFetch) => {
    const req = httpRequest(url, { method: 'GET' }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (text += c))
      res.on('end', () => {
        try {
          resolveFetch(JSON.parse(text))
        } catch (e) {
          rejectFetch(e)
        }
      })
    })
    req.on('error', rejectFetch)
    req.end()
  })
}

async function cdpEvaluate(host, expression) {
  const targets = await fetchJson(`http://${host}/json/list`)
  const mainTarget = targets.find(
    (target) => target.type === 'page' && /^https?:\/\/localhost/.test(target.url ?? '')
  )
  if (!mainTarget) throw new Error('Main window CDP target not found.')
  return new Promise((resolveEval, rejectEval) => {
    const ws = new WebSocket(mainTarget.webSocketDebuggerUrl)
    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true }
        })
      )
    })
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id === 1) {
        ws.close()
        if (message.error) rejectEval(new Error(message.error.message))
        else resolveEval(message.result?.result?.value)
      }
    })
    ws.addEventListener('error', () => rejectEval(new Error('CDP connect failed')))
  })
}

async function captureAll(smoke, suffix) {
  for (const tab of tabs) {
    try {
      await smokeCommandRetry(smoke, 'open-tab', { tab })
    } catch {
      /* selector waits can time out while the tab still opens */
    }
    await sleep(1200)
    const shot = await smokeCommand(smoke, 'capture-page', { name: `${tab}-${suffix}` })
    console.log(`${tab} (${suffix}): ${shot.file}`)
  }
}

let devtoolsUrl = null
const userDataDir = mkdtempSync(join(tmpdir(), 'videorc-ui-shots-'))
const launched = await launchDevApp({
  requiredMarkers: ['backend-ready', 'preview-motion-ready'],
  timeoutMs,
  env: {
    VIDEORC_SMOKE_PREVIEW_MOTION: '1',
    VIDEORC_USER_DATA_DIR: userDataDir,
    VIDEORC_DATABASE_PATH: join(userDataDir, 'videorc.sqlite3'),
    VIDEORC_REMOTE_DEBUG_PORT: '0',
    VIDEORC_SMOKE_OUTPUT_DIR: '/tmp'
  },
  onLine: (line) => {
    const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(line)
    if (match) devtoolsUrl = match[1]
  }
})

const smoke = launched.connections['preview-motion-ready']

try {
  await sleep(6000)
  const { host } = new URL(devtoolsUrl.replace('ws://', 'http://'))

  const defaultThemeClass = await cdpEvaluate(host, 'document.documentElement.className')
  console.log(`fresh-profile root class: "${defaultThemeClass}"`)

  await captureAll(smoke, 'dark')

  console.log('flipping to light...')
  await cdpEvaluate(host, `localStorage.setItem('videorc.theme', 'light'); location.reload(); 'ok'`)
  await sleep(6000)
  const lightThemeClass = await cdpEvaluate(host, 'document.documentElement.className')
  console.log(`light root class: "${lightThemeClass}"`)
  await captureAll(smoke, 'light')
} finally {
  await launched.stop()
}
