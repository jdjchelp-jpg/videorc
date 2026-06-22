// Asserts the macOS packaging inputs exist before electron-builder runs,
// because missing extraResources inputs should fail loudly before packaging.

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const inputs = [
  {
    path: join(repoRoot, 'target', 'release', 'videorc-backend'),
    remedy: 'pnpm package:backend:macos'
  },
  {
    path: join(repoRoot, 'target', 'release', 'native_preview_host_helper'),
    remedy: 'pnpm package:backend:macos'
  },
  {
    path: join(repoRoot, 'vendor', 'ffmpeg', 'current', 'bin', 'ffmpeg'),
    remedy: 'pnpm ffmpeg:build:macos'
  },
  {
    path: join(repoRoot, 'vendor', 'ffmpeg', 'current', 'bin', 'ffprobe'),
    remedy: 'FFMPEG_REBUILD=1 pnpm ffmpeg:build:macos'
  }
]

const missing = inputs.filter((input) => !existsSync(input.path))
for (const input of missing) {
  console.error(`preflight-macos-package: MISSING ${input.path} - produce it with: ${input.remedy}`)
}
if (missing.length > 0) {
  process.exit(1)
}
console.log('preflight-macos-package: all macOS packaging inputs present.')
