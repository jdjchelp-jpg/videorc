// Tests for the A/V sync (lip-sync) measurement.
// Run: node --test scripts/lib/av-sync.test.mjs

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import {
  clickOnsetsFromSilences,
  clusterFlashes,
  evaluateAvSync,
  flashClickFixtureArgs,
  measureAvOffset,
  measureAvSync,
  parseSignalstatsYavg,
  recommendMicrophoneSyncOffsetMs,
} from './av-sync.mjs'

const ffmpegPath = process.env.VIDEORC_SMOKE_FFMPEG_PATH ?? 'ffmpeg'

// --- Unit tests (pure) ---

describe('parseSignalstatsYavg', () => {
  it('pairs pts_time with the following YAVG', () => {
    const stderr = [
      '[Parsed_metadata_1 @ 0x1] frame:0 pts:0 pts_time:0',
      '[Parsed_metadata_1 @ 0x1] lavfi.signalstats.YAVG=16.0',
      '[Parsed_metadata_1 @ 0x1] frame:1 pts:1 pts_time:0.033',
      '[Parsed_metadata_1 @ 0x1] lavfi.signalstats.YAVG=235.0',
    ].join('\n')
    assert.deepEqual(parseSignalstatsYavg(stderr), [
      { ptsTime: 0, yavg: 16 },
      { ptsTime: 0.033, yavg: 235 },
    ])
  })
})

describe('clusterFlashes', () => {
  it('collapses consecutive bright frames into one onset per run', () => {
    const frames = [
      { ptsTime: 0.0, yavg: 235 },
      { ptsTime: 0.033, yavg: 235 },
      { ptsTime: 0.066, yavg: 16 },
      { ptsTime: 1.0, yavg: 235 },
      { ptsTime: 1.033, yavg: 235 },
    ]
    assert.deepEqual(clusterFlashes(frames, 100), [0.0, 1.0])
  })
})

describe('clickOnsetsFromSilences', () => {
  it('uses silence-end times as click onsets', () => {
    const silences = [
      { start: 0.06, end: 1.0, duration: 0.94 },
      { start: 1.06, end: 2.0, duration: 0.94 },
    ]
    assert.deepEqual(clickOnsetsFromSilences(silences), [1.0, 2.0])
  })
})

describe('measureAvOffset', () => {
  it('reports a positive offset when audio lags video', () => {
    const m = measureAvOffset([0, 1, 2, 3], [0.2, 1.2, 2.2, 3.2])
    assert.equal(m.pairs.length, 4)
    assert.ok(Math.abs(m.medianOffsetMs - 200) < 1, `median ${m.medianOffsetMs}`)
  })

  it('ignores flashes with no click inside the window', () => {
    const m = measureAvOffset([0, 10], [0.05], 500)
    assert.equal(m.pairs.length, 1)
    assert.ok(Math.abs(m.medianOffsetMs - 50) < 1)
  })
})

describe('evaluateAvSync', () => {
  it('passes in-spec, warns over target, hard-fails over 150ms', () => {
    assert.equal(evaluateAvSync({ medianOffsetMs: 40 }).pass, true)
    const warn = evaluateAvSync({ medianOffsetMs: 120 })
    assert.equal(warn.pass, true)
    assert.equal(warn.warnings.length, 1)
    assert.equal(evaluateAvSync({ medianOffsetMs: 220 }).pass, false)
    assert.equal(evaluateAvSync({ medianOffsetMs: -200 }).pass, false)
  })

  it('hard-fails when no flash/click pairs were detected', () => {
    const verdict = evaluateAvSync({ medianOffsetMs: null })
    assert.equal(verdict.pass, false)
    assert.ok(verdict.failures.some((f) => /no flash\/click pairs/.test(f)))
  })

  it('can hard-fail target misses for final acceptance', () => {
    const verdict = evaluateAvSync({ medianOffsetMs: 120 }, { targetMs: 100, hardFailMs: 150, requireTarget: true })
    assert.equal(verdict.pass, false)
    assert.ok(verdict.failures.some((f) => /exceeds target/.test(f)))
  })
})

describe('recommendMicrophoneSyncOffsetMs', () => {
  it('moves the microphone offset negative when audio lags video', () => {
    assert.equal(recommendMicrophoneSyncOffsetMs({ medianOffsetMs: 121 }, 0), -121)
    assert.equal(recommendMicrophoneSyncOffsetMs({ medianOffsetMs: 46 }, -120), -166)
  })

  it('moves the microphone offset positive when audio leads video and clamps bounds', () => {
    assert.equal(recommendMicrophoneSyncOffsetMs({ medianOffsetMs: -80 }, -120), -40)
    assert.equal(recommendMicrophoneSyncOffsetMs({ medianOffsetMs: 300 }, -900), -1000)
    assert.equal(recommendMicrophoneSyncOffsetMs({ medianOffsetMs: -300 }, 900), 1000)
  })

  it('does not recommend a setting without a paired measurement', () => {
    assert.equal(recommendMicrophoneSyncOffsetMs({ medianOffsetMs: null }, 0), null)
  })
})

// --- Integration: recover a known injected offset from a real fixture ---

function generate(outputPath, opts) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(ffmpegPath, flashClickFixtureArgs(outputPath, opts))
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (t) => (stderr += t))
    child.on('error', rejectRun)
    child.on('close', (code) => (code === 0 ? resolveRun() : rejectRun(new Error(stderr.trim()))))
  })
}

describe('measureAvSync (integration)', () => {
  let dir
  let aligned
  let offset

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vrc-avsync-'))
    aligned = join(dir, 'aligned.mp4')
    offset = join(dir, 'offset200.mp4')
    await generate(aligned, { seconds: 5, audioDelayMs: 0 })
    await generate(offset, { seconds: 5, audioDelayMs: 200 })
  })

  after(() => {
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  })

  it('measures ~0ms on an aligned flash+click recording', async () => {
    const result = await measureAvSync(aligned, { ffmpegPath })
    assert.ok(result.flashCount >= 4, `flashes ${result.flashCount}`)
    assert.ok(result.clickCount >= 4, `clicks ${result.clickCount}`)
    assert.ok(Math.abs(result.medianOffsetMs) < 60, `median ${result.medianOffsetMs}ms`)
    assert.equal(result.pass, true)
  })

  it('recovers an injected 200ms A/V offset and hard-fails it', async () => {
    const result = await measureAvSync(offset, { ffmpegPath, currentMicrophoneSyncOffsetMs: 0 })
    assert.ok(
      result.medianOffsetMs > 150 && result.medianOffsetMs < 260,
      `expected ~200ms, got ${result.medianOffsetMs}ms`
    )
    assert.equal(result.pass, false)
    assert.ok(result.failures.some((f) => /A\/V sync/.test(f)))
    assert.ok(
      result.recommendedMicrophoneSyncOffsetMs <= -150 && result.recommendedMicrophoneSyncOffsetMs >= -260,
      `suggested ${result.recommendedMicrophoneSyncOffsetMs}ms`
    )
  })
})
