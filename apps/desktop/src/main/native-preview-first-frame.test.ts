import { describe, expect, it } from 'vitest'

import {
  assessFirstFrame,
  DEFAULT_FIRST_FRAME_BUDGETS,
  emptyFirstFrameLedger,
  firstFrameBlockedReason,
  firstFrameContractMet,
  type FirstFrameSnapshot
} from './native-preview-first-frame'

function snapshot(overrides: Partial<FirstFrameSnapshot> = {}): FirstFrameSnapshot {
  return {
    elapsedMs: 0,
    surfaceLive: true,
    nativePresenting: true,
    framesAdvancing: true,
    rendererSceneRevision: 42,
    compositorSceneRevision: 42,
    compositorFrameSceneRevision: 42,
    metalTargetPresent: true,
    ...overrides
  }
}

describe('firstFrameContractMet', () => {
  it('is met only when the whole chain agrees and advances', () => {
    expect(firstFrameContractMet(snapshot())).toBe(true)
    expect(firstFrameContractMet(snapshot({ surfaceLive: false }))).toBe(false)
    expect(firstFrameContractMet(snapshot({ nativePresenting: false }))).toBe(false)
    expect(firstFrameContractMet(snapshot({ framesAdvancing: false }))).toBe(false)
    expect(firstFrameContractMet(snapshot({ metalTargetPresent: false }))).toBe(false)
    expect(firstFrameContractMet(snapshot({ rendererSceneRevision: null }))).toBe(false)
    expect(firstFrameContractMet(snapshot({ compositorSceneRevision: 41 }))).toBe(false)
    expect(firstFrameContractMet(snapshot({ compositorFrameSceneRevision: 41 }))).toBe(false)
  })
})

describe('firstFrameBlockedReason', () => {
  it('names the first blocked link in chain order', () => {
    expect(firstFrameBlockedReason(snapshot({ surfaceLive: false }))).toMatch(/surface is starting/)
    expect(firstFrameBlockedReason(snapshot({ rendererSceneRevision: null }))).toMatch(
      /commit its scene/
    )
    // A foreign/stale compositor scene (2026-07-01 incident: smoke scene held the
    // compositor while the app had committed a different revision).
    expect(
      firstFrameBlockedReason(snapshot({ compositorSceneRevision: 7, rendererSceneRevision: 42 }))
    ).toBe('Compositor is on scene revision 7, but the app committed 42.')
    expect(
      firstFrameBlockedReason(
        snapshot({ compositorFrameSceneRevision: 41, compositorSceneRevision: 42 })
      )
    ).toBe('Waiting for the compositor to render scene revision 42.')
    expect(firstFrameBlockedReason(snapshot({ metalTargetPresent: false }))).toMatch(
      /Metal IOSurface target/
    )
    expect(firstFrameBlockedReason(snapshot({ framesAdvancing: false }))).toMatch(
      /frames are not advancing/
    )
    expect(firstFrameBlockedReason(snapshot({ nativePresenting: false }))).toMatch(
      /Native presenter/
    )
  })
})

describe('assessFirstFrame', () => {
  it('reports met and leaves the ledger untouched', () => {
    const ledger = emptyFirstFrameLedger()
    const { assessment } = assessFirstFrame(snapshot({ elapsedMs: 500 }), ledger)
    expect(assessment).toEqual({ kind: 'met' })
  })

  it('is pending (no heal) before the first action budget', () => {
    const { assessment } = assessFirstFrame(
      snapshot({ elapsedMs: 800, nativePresenting: false }),
      emptyFirstFrameLedger()
    )
    expect(assessment.kind).toBe('pending')
  })

  it('fires present-kick first for a generic stall', () => {
    const { assessment, ledger } = assessFirstFrame(
      snapshot({ elapsedMs: 1600, framesAdvancing: false, nativePresenting: false }),
      emptyFirstFrameLedger()
    )
    expect(assessment).toMatchObject({ kind: 'heal', action: 'present-kick' })
    expect(ledger.attempts['present-kick']).toBe(1)
    expect(ledger.lastActionAtMs).toBe(1600)
  })

  it('goes straight to resync-scene when the compositor holds a foreign scene', () => {
    const { assessment } = assessFirstFrame(
      snapshot({
        elapsedMs: 3200,
        compositorSceneRevision: 999999,
        compositorFrameSceneRevision: 999999,
        nativePresenting: false
      }),
      emptyFirstFrameLedger()
    )
    expect(assessment).toMatchObject({ kind: 'heal', action: 'resync-scene' })
  })

  it('goes straight to reset-native-path when frames render but native never presents', () => {
    const { assessment } = assessFirstFrame(
      snapshot({ elapsedMs: 6500, nativePresenting: false }),
      emptyFirstFrameLedger()
    )
    expect(assessment).toMatchObject({ kind: 'heal', action: 'reset-native-path' })
  })

  it('spaces actions and caps attempts per action', () => {
    let ledger = emptyFirstFrameLedger()
    const stall = (elapsedMs: number) =>
      snapshot({ elapsedMs, framesAdvancing: false, nativePresenting: false })

    let result = assessFirstFrame(stall(1600), ledger)
    expect(result.assessment).toMatchObject({ kind: 'heal', action: 'present-kick' })
    ledger = result.ledger

    // Too soon after the last action: pending, not another heal.
    result = assessFirstFrame(stall(2200), ledger)
    expect(result.assessment.kind).toBe('pending')

    result = assessFirstFrame(stall(2900), ledger)
    expect(result.assessment).toMatchObject({ kind: 'heal', action: 'present-kick' })
    ledger = result.ledger

    // present-kick exhausted (2 attempts): the ladder moves on.
    result = assessFirstFrame(stall(4200), ledger)
    expect(result.assessment).toMatchObject({ kind: 'heal', action: 'resync-scene' })
  })

  it('declares fallback with the truthful reason after the budget', () => {
    const { assessment } = assessFirstFrame(
      snapshot({ elapsedMs: 15001, metalTargetPresent: false, nativePresenting: false }),
      emptyFirstFrameLedger()
    )
    expect(assessment).toMatchObject({ kind: 'fallback' })
    expect((assessment as { reason: string }).reason).toMatch(/Metal IOSurface target/)
  })

  it('keeps the default budgets ordered cheapest-first', () => {
    const budgets = DEFAULT_FIRST_FRAME_BUDGETS
    expect(budgets.presentKickAfterMs).toBeLessThan(budgets.resyncSceneAfterMs)
    expect(budgets.resyncSceneAfterMs).toBeLessThan(budgets.resetNativePathAfterMs)
    expect(budgets.resetNativePathAfterMs).toBeLessThan(budgets.declareFallbackAfterMs)
  })
})
