import assert from 'node:assert/strict'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const ts = require('../apps/desktop/node_modules/typescript')

const sourcePath = join(process.cwd(), 'apps/desktop/src/renderer/src/lib/capture.ts')
const tempDir = join(tmpdir(), `videorc-start-labels-${Date.now()}`)
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

  const { startButtonLabel, startButtonPendingLabel } = require(tempModule)
  assert.equal(startButtonLabel(true, false), 'Start Recording')
  assert.equal(startButtonLabel(false, true), 'Start Livestream')
  assert.equal(startButtonLabel(true, true), 'Start Livestream + Record')
  assert.equal(startButtonLabel(false, false), 'Start Session')
  assert.equal(startButtonPendingLabel(false), 'Starting Recording...')
  assert.equal(startButtonPendingLabel(true), 'Starting Livestream...')

  console.log('Start label smoke OK - record, livestream, dual-output, and pending labels verified.')
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
