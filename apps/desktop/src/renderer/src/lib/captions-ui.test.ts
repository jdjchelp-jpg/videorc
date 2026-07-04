import { describe, expect, it } from 'vitest'

import type { CaptionsUpdate } from '@/lib/backend'
import {
  appendCaptionLine,
  captionLineAboveFloor,
  captionSessionFloor,
  captionStripLines,
  decideOverlayPush
} from './captions-ui'

const update = (seq: number, overrides: Partial<CaptionsUpdate> = {}): CaptionsUpdate => ({
  sessionClientId: 'captions-session-a',
  seq,
  text: `line ${seq}`,
  chunkSeconds: 3,
  ...overrides
})

describe('appendCaptionLine', () => {
  it('appends in order, replaces same-seq updates, drops older seqs', () => {
    let lines: CaptionsUpdate[] = []
    lines = appendCaptionLine(lines, update(1))
    lines = appendCaptionLine(lines, update(2, { kind: 'partial', text: 'hel' }))
    // Streaming: the same utterance refines partial → partial → final.
    lines = appendCaptionLine(lines, update(2, { kind: 'partial', text: 'hello there' }))
    lines = appendCaptionLine(lines, update(2, { kind: 'final', text: 'Hello there.' }))
    lines = appendCaptionLine(lines, update(1))
    expect(lines.map((line) => line.seq)).toEqual([1, 2])
    expect(lines.at(-1)?.text).toBe('Hello there.')
    expect(lines.at(-1)?.kind).toBe('final')
  })

  it('resets the buffer when a new caption session starts', () => {
    let lines = [update(5)]
    lines = appendCaptionLine(lines, update(1, { sessionClientId: 'captions-session-b' }))
    expect(lines).toHaveLength(1)
    expect(lines[0]?.sessionClientId).toBe('captions-session-b')
  })

  it('ignores empty text and caps the buffer', () => {
    let lines: CaptionsUpdate[] = []
    lines = appendCaptionLine(lines, update(1, { text: '   ' }))
    expect(lines).toHaveLength(0)
    for (let seq = 1; seq <= 60; seq += 1) {
      lines = appendCaptionLine(lines, update(seq), 50)
    }
    expect(lines).toHaveLength(50)
    expect(lines.at(0)?.seq).toBe(11)
    expect(lines.at(-1)?.seq).toBe(60)
  })
})

describe('captionStripLines', () => {
  it('returns only the most recent lines', () => {
    const lines = [update(1), update(2), update(3), update(4)]
    expect(captionStripLines(lines, 2).map((line) => line.seq)).toEqual([3, 4])
  })
})

describe('caption session floor', () => {
  it('captures the newest line identity and gates lines at or below it', () => {
    const floor = captionSessionFloor([update(3), update(7)])
    expect(floor).toEqual({ sessionClientId: 'captions-session-a', seq: 7 })
    // Late transcript of PREVIOUS-video audio (same caption session, in-flight
    // seq assigned before the boundary) must be rejected.
    expect(captionLineAboveFloor(update(7), floor)).toBe(false)
    expect(captionLineAboveFloor(update(8), floor)).toBe(true)
    // A restarted caption session is always fresh.
    expect(captionLineAboveFloor(update(1, { sessionClientId: 'captions-session-b' }), floor)).toBe(
      true
    )
  })

  it('is null (gates nothing) for an empty buffer', () => {
    expect(captionSessionFloor([])).toBeNull()
    expect(captionLineAboveFloor(update(1), null)).toBe(true)
  })
})

describe('decideOverlayPush', () => {
  const base = {
    burnIn: true,
    captionsRunning: true,
    sessionActive: true,
    latest: update(8),
    floor: { sessionClientId: 'captions-session-a', seq: 5 },
    pushedKey: null,
    busy: false
  }

  it('pushes a fresh line once, then goes quiet until the text evolves', () => {
    const first = decideOverlayPush(base)
    expect(first.action).toBe('push')
    expect(decideOverlayPush({ ...base, pushedKey: first.key }).action).toBe('none')
    expect(
      decideOverlayPush({
        ...base,
        pushedKey: first.key,
        latest: update(8, { text: 'line 8 refined' })
      }).action
    ).toBe('push')
  })

  it('REGRESSION (carry-over bug): never re-pushes the previous video at the next session start', () => {
    // Video 1 ends: overlay cleared, pushedKey null — but the previous
    // video's last line is still the newest buffer entry. Video 2 starts with
    // the floor recorded at the boundary: that line must NOT be pushed.
    const decision = decideOverlayPush({
      ...base,
      latest: update(5),
      floor: { sessionClientId: 'captions-session-a', seq: 5 },
      pushedKey: null
    })
    expect(decision.action).toBe('none')
  })

  it('clears the bar (once) when burn-in, captions, or the session stops', () => {
    expect(decideOverlayPush({ ...base, sessionActive: false, pushedKey: '5:x' }).action).toBe(
      'clear'
    )
    expect(decideOverlayPush({ ...base, burnIn: false, pushedKey: null }).action).toBe('none')
    expect(decideOverlayPush({ ...base, captionsRunning: false, pushedKey: '5:x' }).action).toBe(
      'clear'
    )
  })

  it('stays quiet while a rasterize round-trip is in flight or there is no line', () => {
    expect(decideOverlayPush({ ...base, busy: true }).action).toBe('none')
    expect(decideOverlayPush({ ...base, latest: undefined }).action).toBe('none')
  })
})
