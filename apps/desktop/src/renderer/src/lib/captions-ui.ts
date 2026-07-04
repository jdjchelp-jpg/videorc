import type { CaptionsUpdate } from '@/lib/backend'

/** Lines kept for the captions strip / detached window. */
export const MAX_CAPTION_LINES = 50

/**
 * Append a caption update: streaming PARTIALS (and the final that settles
 * them) REPLACE the line with the same seq; older seqs are dropped
 * (chunked-retry duplicates); a new caption session resets the buffer.
 * Newest line last; capped to MAX_CAPTION_LINES.
 */
export function appendCaptionLine(
  lines: CaptionsUpdate[],
  update: CaptionsUpdate,
  max = MAX_CAPTION_LINES
): CaptionsUpdate[] {
  if (!update.text.trim()) {
    return lines
  }
  const last = lines.at(-1)
  if (last && last.sessionClientId !== update.sessionClientId) {
    return [update]
  }
  if (last && update.seq === last.seq) {
    // The utterance is still evolving (partial → partial → final).
    return [...lines.slice(0, -1), update]
  }
  if (last && update.seq < last.seq) {
    return lines
  }
  return [...lines, update].slice(-max)
}

/** The strip shows the tail of the transcript, most recent lines only. */
export function captionStripLines(lines: CaptionsUpdate[], count = 3): CaptionsUpdate[] {
  return lines.slice(-count)
}

/**
 * Session boundary marker for the caption display state. Captions belong to
 * the video they were spoken in: at each capture-session start the buffer is
 * cleared AND this floor is recorded, so a transcript of PREVIOUS-video audio
 * that arrives late (chunk uploads finish after the boundary) can never show
 * up — or get burned — in the new video. The caption session and its
 * sessionClientId outlive recordings, so seq is the only usable watermark.
 */
export interface CaptionSessionFloor {
  sessionClientId: string
  seq: number
}

export function captionSessionFloor(lines: CaptionsUpdate[]): CaptionSessionFloor | null {
  const last = lines.at(-1)
  return last ? { sessionClientId: last.sessionClientId, seq: last.seq } : null
}

/** A line clears the floor when it starts a new caption session or advances
 * past the last seq seen before the current capture session began. */
export function captionLineAboveFloor(
  line: CaptionsUpdate,
  floor: CaptionSessionFloor | null
): boolean {
  if (!floor || line.sessionClientId !== floor.sessionClientId) {
    return true
  }
  return line.seq > floor.seq
}

/**
 * One decision for the burn-in overlay driver, pure so the two-consecutive-
 * sessions regression is unit-testable: 'clear' takes the bar down (burn off,
 * captions stopped, or no active session), 'push' rasterizes the latest line,
 * 'none' leaves the compositor untouched. A line at or below the session
 * floor is never pushed — re-pushing the previous video's last caption at the
 * next session start is exactly the carry-over bug (2026-07-04).
 */
export function decideOverlayPush(input: {
  burnIn: boolean
  captionsRunning: boolean
  sessionActive: boolean
  latest: CaptionsUpdate | undefined
  floor: CaptionSessionFloor | null
  pushedKey: string | null
  busy: boolean
}): { action: 'push' | 'clear' | 'none'; key: string | null } {
  if (!input.burnIn || !input.captionsRunning || !input.sessionActive) {
    return { action: input.pushedKey !== null ? 'clear' : 'none', key: null }
  }
  if (!input.latest || input.busy || !captionLineAboveFloor(input.latest, input.floor)) {
    return { action: 'none', key: input.pushedKey }
  }
  // Streaming partials share a seq while the text evolves — key on both so
  // the live bar refreshes with every refinement.
  const key = `${input.latest.seq}:${input.latest.text}`
  if (input.pushedKey === key) {
    return { action: 'none', key }
  }
  return { action: 'push', key }
}
