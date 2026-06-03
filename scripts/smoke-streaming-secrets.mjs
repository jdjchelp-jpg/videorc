import assert from 'node:assert/strict'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const ts = require('../apps/desktop/node_modules/typescript')

const sourcePath = join(process.cwd(), 'apps/desktop/src/renderer/src/lib/capture.ts')
const tempDir = join(tmpdir(), `videorc-streaming-secrets-${Date.now()}`)
const tempModule = join(tempDir, 'capture.cjs')

await mkdir(tempDir, { recursive: true })
try {
  const source = await readFile(sourcePath, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  })
  await writeFile(tempModule, transpiled.outputText)

  const { normalizeStreamingSettings } = require(tempModule)
  const normalized = normalizeStreamingSettings({
    enabled: true,
    mode: 'single',
    enabledTargetIds: ['youtube'],
    targets: [
      {
        id: 'youtube',
        platform: 'youtube',
        label: 'YouTube',
        enabled: true,
        serverUrl: 'rtmp://a.rtmp.youtube.com/live2',
        urlMode: 'server-and-key',
        streamKey: '',
        streamKeySecretRef: 'secret://youtube-stream-key',
        streamKeyPresent: true,
        authMode: 'oauth',
        accountId: 'youtube-account',
        accountLabel: 'Videorc',
        platformBroadcastId: 'broadcast-123',
        platformStreamId: 'stream-123',
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z'
      }
    ]
  })

  const youtube = normalized.targets.find((target) => target.platform === 'youtube')
  assert.ok(youtube)
  assert.equal(youtube.authMode, 'oauth')
  assert.equal(youtube.streamKey, '')
  assert.equal(youtube.streamKeySecretRef, 'secret://youtube-stream-key')
  assert.equal(youtube.streamKeyPresent, true)
  assert.equal(youtube.platformBroadcastId, 'broadcast-123')
  assert.equal(youtube.platformStreamId, 'stream-123')

  const twitch = normalized.targets.find((target) => target.platform === 'twitch')
  assert.ok(twitch)
  assert.equal(twitch.streamKeyPresent, false)
  assert.equal(twitch.streamKeySecretRef, undefined)

  console.log('Streaming secret smoke OK - OAuth secret refs survive reload without raw keys.')
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
