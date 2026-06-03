import assert from 'node:assert/strict'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('../apps/desktop/node_modules/typescript')

const sourcePath = join(process.cwd(), 'apps/desktop/src/renderer/src/lib/capture.ts')
const tempDir = join(tmpdir(), `videorc-source-reconciliation-${Date.now()}`)
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

  const storage = new Map()
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear()
  }

  const { defaultCaptureConfig, loadCaptureConfig, persistableCaptureConfig, reconcileSourceSelection, STORAGE_KEYS } =
    require(tempModule)
  assert.equal(typeof reconcileSourceSelection, 'function')

  const devices = [
    device('screen-new', 'Built-in Display', 'screen'),
    device('screen-other', 'Studio Monitor', 'screen'),
    device('window-1', 'Editor', 'window'),
    device('camera-new', 'FaceTime HD Camera', 'camera'),
    device('camera-other', 'Desk Camera', 'camera'),
    device('mic-new', 'Podcast Mic', 'microphone'),
    device('mic-other', 'Laptop Mic', 'microphone')
  ]

  localStorage.setItem(
    STORAGE_KEYS.captureConfig,
    JSON.stringify(
      persistableCaptureConfig({
        ...defaultCaptureConfig,
        sources: {
          screenId: 'screen-old',
          screenName: 'Built-in Display',
          cameraId: 'camera-old',
          cameraName: 'FaceTime HD Camera',
          microphoneId: 'mic-old',
          microphoneName: 'Podcast Mic'
        }
      })
    )
  )
  const loaded = loadCaptureConfig()
  assert.deepEqual(loaded.sources, {
    screenId: 'screen-old',
    screenName: 'Built-in Display',
    cameraId: 'camera-old',
    cameraName: 'FaceTime HD Camera',
    microphoneId: 'mic-old',
    microphoneName: 'Podcast Mic'
  })
  assert.deepEqual(reconcileSourceSelection(loaded.sources, devices), {
    screenId: 'screen-new',
    screenName: 'Built-in Display',
    windowId: undefined,
    windowName: undefined,
    cameraId: 'camera-new',
    cameraName: 'FaceTime HD Camera',
    microphoneId: 'mic-new',
    microphoneName: 'Podcast Mic'
  })

  assert.deepEqual(
    reconcileSourceSelection(
      {
        screenId: 'screen-old',
        screenName: 'Built-in Display',
        cameraId: 'camera-old',
        cameraName: 'FaceTime HD Camera',
        microphoneId: 'mic-old',
        microphoneName: 'Podcast Mic'
      },
      devices
    ),
    {
      screenId: 'screen-new',
      screenName: 'Built-in Display',
      windowId: undefined,
      windowName: undefined,
      cameraId: 'camera-new',
      cameraName: 'FaceTime HD Camera',
      microphoneId: 'mic-new',
      microphoneName: 'Podcast Mic'
    }
  )

  assert.deepEqual(
    reconcileSourceSelection(
      {
        windowId: 'window-1',
        windowName: 'Editor',
        screenId: 'screen-old',
        screenName: 'Built-in Display',
        cameraId: 'camera-other',
        cameraName: 'Desk Camera',
        microphoneId: 'mic-other',
        microphoneName: 'Laptop Mic'
      },
      devices
    ),
    {
      screenId: undefined,
      screenName: undefined,
      windowId: 'window-1',
      windowName: 'Editor',
      cameraId: 'camera-other',
      cameraName: 'Desk Camera',
      microphoneId: 'mic-other',
      microphoneName: 'Laptop Mic'
    }
  )

  assert.deepEqual(
    reconcileSourceSelection(
      {
        screenId: 'missing-screen',
        screenName: 'Missing Display',
        cameraId: 'missing-camera',
        cameraName: 'Missing Camera',
        microphoneId: 'missing-mic',
        microphoneName: 'Missing Mic'
      },
      devices
    ),
    {
      screenId: 'screen-new',
      screenName: 'Built-in Display',
      windowId: undefined,
      windowName: undefined,
      cameraId: 'camera-new',
      cameraName: 'FaceTime HD Camera',
      microphoneId: 'mic-new',
      microphoneName: 'Podcast Mic'
    }
  )

  assert.deepEqual(
    reconcileSourceSelection(
      {
        screenId: 'screen-new',
        screenName: 'Built-in Display',
        cameraId: 'camera-new',
        cameraName: 'FaceTime HD Camera',
        microphoneId: 'mic-new',
        microphoneName: 'Podcast Mic'
      },
      devices.map((item) => (item.kind === 'camera' ? { ...item, status: 'unavailable' } : item))
    ),
    {
      screenId: 'screen-new',
      screenName: 'Built-in Display',
      windowId: undefined,
      windowName: undefined,
      cameraId: undefined,
      cameraName: undefined,
      microphoneId: 'mic-new',
      microphoneName: 'Podcast Mic'
    }
  )

  console.log('Source reconciliation smoke OK - persisted IDs, name rematch, and fallback behavior verified.')
} finally {
  await rm(tempDir, { recursive: true, force: true })
}

function device(id, name, kind) {
  return { id, name, kind, status: 'available' }
}
