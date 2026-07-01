// First-frame contract for the detached native preview (Definitive Fix Plan P2).
//
// From the moment the preview window opens, the app OWES the user one of three
// outcomes within budget: a native CAMetalLayer frame of the app's committed
// scene, a self-heal that gets there, or a declared fallback with the exact
// blocked link. "Waiting for preview" forever is not an outcome.
//
// This module is the pure decision core (electron-free, unit-tested): given a
// snapshot of the chain each tick, it says whether the contract is met, which
// healing action to fire next, and the truthful reason string for the preview
// window's waiting hint. index.ts owns the timers and executes the actions.

export interface FirstFrameSnapshot {
  elapsedMs: number
  surfaceLive: boolean
  /** transport === 'native-surface' && backing === 'cametal-layer' */
  nativePresenting: boolean
  /** compositor framesRendered advanced since the previous tick */
  framesAdvancing: boolean
  /** revision of the scene the renderer last pushed (null before first push) */
  rendererSceneRevision: number | null
  compositorSceneRevision: number | null
  compositorFrameSceneRevision: number | null
  metalTargetPresent: boolean
}

export type FirstFrameHealingAction = 'present-kick' | 'resync-scene' | 'reset-native-path'

export interface FirstFrameLedger {
  lastActionAtMs: number
  attempts: Record<FirstFrameHealingAction, number>
}

export interface FirstFrameBudgets {
  /** earliest elapsed time each action may fire */
  presentKickAfterMs: number
  resyncSceneAfterMs: number
  resetNativePathAfterMs: number
  /** minimum spacing between any two healing actions */
  actionSpacingMs: number
  /** attempts allowed per action before moving on */
  attemptsPerAction: number
  /** elapsed time after which the contract is declared failed */
  declareFallbackAfterMs: number
}

export const DEFAULT_FIRST_FRAME_BUDGETS: FirstFrameBudgets = {
  presentKickAfterMs: 1500,
  resyncSceneAfterMs: 3000,
  resetNativePathAfterMs: 6000,
  actionSpacingMs: 1200,
  attemptsPerAction: 2,
  declareFallbackAfterMs: 15000
}

export type FirstFrameAssessment =
  | { kind: 'met' }
  | { kind: 'pending'; reason: string }
  | { kind: 'heal'; action: FirstFrameHealingAction; reason: string }
  | { kind: 'fallback'; reason: string }

export function emptyFirstFrameLedger(): FirstFrameLedger {
  return {
    lastActionAtMs: 0,
    attempts: { 'present-kick': 0, 'resync-scene': 0, 'reset-native-path': 0 }
  }
}

export function firstFrameContractMet(snapshot: FirstFrameSnapshot): boolean {
  return (
    snapshot.surfaceLive &&
    snapshot.nativePresenting &&
    snapshot.framesAdvancing &&
    snapshot.metalTargetPresent &&
    snapshot.rendererSceneRevision != null &&
    snapshot.compositorSceneRevision === snapshot.rendererSceneRevision &&
    snapshot.compositorFrameSceneRevision === snapshot.compositorSceneRevision
  )
}

// The truthful waiting reason, ordered by which link of the chain is blocked
// first. This string is shown verbatim in the preview window hint.
export function firstFrameBlockedReason(snapshot: FirstFrameSnapshot): string {
  if (!snapshot.surfaceLive) {
    return 'Preview surface is starting.'
  }
  if (snapshot.rendererSceneRevision == null) {
    return 'Waiting for the app to commit its scene.'
  }
  if (
    snapshot.compositorSceneRevision != null &&
    snapshot.compositorSceneRevision !== snapshot.rendererSceneRevision
  ) {
    return `Compositor is on scene revision ${snapshot.compositorSceneRevision}, but the app committed ${snapshot.rendererSceneRevision}.`
  }
  if (
    snapshot.compositorFrameSceneRevision != null &&
    snapshot.compositorSceneRevision != null &&
    snapshot.compositorFrameSceneRevision !== snapshot.compositorSceneRevision
  ) {
    return `Waiting for the compositor to render scene revision ${snapshot.compositorSceneRevision}.`
  }
  if (!snapshot.metalTargetPresent) {
    return 'Compositor has not produced a Metal IOSurface target yet.'
  }
  if (!snapshot.framesAdvancing) {
    return 'Compositor frames are not advancing.'
  }
  if (!snapshot.nativePresenting) {
    return 'Native presenter has not confirmed a frame yet.'
  }
  return 'Waiting for the first native frame.'
}

// Which healing action does this blocked link call for? The ladder is ordered
// cheapest-first, but a diagnosed link can skip ahead (a scene-revision divergence
// goes straight to resync; a dead native presenter goes straight to path reset).
function preferredAction(snapshot: FirstFrameSnapshot): FirstFrameHealingAction {
  if (
    snapshot.rendererSceneRevision != null &&
    snapshot.compositorSceneRevision != null &&
    snapshot.compositorSceneRevision !== snapshot.rendererSceneRevision
  ) {
    return 'resync-scene'
  }
  if (
    snapshot.surfaceLive &&
    snapshot.metalTargetPresent &&
    snapshot.framesAdvancing &&
    !snapshot.nativePresenting
  ) {
    return 'reset-native-path'
  }
  return 'present-kick'
}

const ACTION_ORDER: FirstFrameHealingAction[] = [
  'present-kick',
  'resync-scene',
  'reset-native-path'
]

function actionAvailableAtMs(action: FirstFrameHealingAction, budgets: FirstFrameBudgets): number {
  switch (action) {
    case 'present-kick':
      return budgets.presentKickAfterMs
    case 'resync-scene':
      return budgets.resyncSceneAfterMs
    case 'reset-native-path':
      return budgets.resetNativePathAfterMs
  }
}

export function assessFirstFrame(
  snapshot: FirstFrameSnapshot,
  ledger: FirstFrameLedger,
  budgets: FirstFrameBudgets = DEFAULT_FIRST_FRAME_BUDGETS
): { assessment: FirstFrameAssessment; ledger: FirstFrameLedger } {
  if (firstFrameContractMet(snapshot)) {
    return { assessment: { kind: 'met' }, ledger }
  }

  const reason = firstFrameBlockedReason(snapshot)
  if (snapshot.elapsedMs >= budgets.declareFallbackAfterMs) {
    return { assessment: { kind: 'fallback', reason }, ledger }
  }

  const sinceLastAction = snapshot.elapsedMs - ledger.lastActionAtMs
  if (ledger.lastActionAtMs > 0 && sinceLastAction < budgets.actionSpacingMs) {
    return { assessment: { kind: 'pending', reason }, ledger }
  }

  // Try the diagnosed action first, then the rest of the ladder in order.
  const preferred = preferredAction(snapshot)
  const candidates = [preferred, ...ACTION_ORDER.filter((action) => action !== preferred)]
  for (const action of candidates) {
    if (snapshot.elapsedMs < actionAvailableAtMs(action, budgets)) {
      continue
    }
    if (ledger.attempts[action] >= budgets.attemptsPerAction) {
      continue
    }
    const nextLedger: FirstFrameLedger = {
      lastActionAtMs: snapshot.elapsedMs,
      attempts: { ...ledger.attempts, [action]: ledger.attempts[action] + 1 }
    }
    return { assessment: { kind: 'heal', action, reason }, ledger: nextLedger }
  }

  return { assessment: { kind: 'pending', reason }, ledger }
}
