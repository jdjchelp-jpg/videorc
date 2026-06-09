import type {
  NativePreviewHostCommand,
  PreviewSurfaceBounds,
  PreviewSurfaceCompositorUpdateParams,
  PreviewSurfaceSceneState,
  PreviewSurfaceStatus
} from './backend'

export interface NativePreviewMetalTargetHandoff {
  iosurfaceId: number
  width: number
  height: number
  frameId: number
  runId?: string
}

export interface NativePreviewRealSurfacePresentRequest {
  handoff: NativePreviewMetalTargetHandoff
  bounds?: PreviewSurfaceBounds
  scene?: PreviewSurfaceSceneState | null
  suppressFramePolling: boolean
  frameAgeMs?: number
  compositorUpdatedAt?: string
}

export interface NativePreviewRealSurfaceDriver {
  applyHostCommands(commands: NativePreviewHostCommand[]): Promise<PreviewSurfaceStatus | null>
  resetMetrics?(): void
  presentCompositorHandoff(
    request: NativePreviewRealSurfacePresentRequest
  ): Promise<PreviewSurfaceStatus | null>
  /** Tear down any external host process/window the driver owns. */
  stop?(): void
}

export const DEFAULT_NATIVE_PREVIEW_MAX_HANDOFF_AGE_MS = 250

export function compositorStatusMetalTargetHandoff(
  status: PreviewSurfaceCompositorUpdateParams,
  options: { nowMs?: number; maxAgeMs?: number } = {}
): NativePreviewMetalTargetHandoff | null {
  const maxAgeMs = options.maxAgeMs
  if (typeof maxAgeMs === 'number' && maxAgeMs >= 0) {
    const updatedAtMs = Date.parse(status.updatedAt)
    const nowMs = options.nowMs ?? Date.now()
    if (!Number.isFinite(updatedAtMs) || nowMs - updatedAtMs > maxAgeMs) {
      return null
    }
  }

  const iosurfaceId = finitePositiveInteger(status.metalTargetIosurfaceId)
  const width = finitePositiveInteger(status.metalTargetWidth)
  const height = finitePositiveInteger(status.metalTargetHeight)
  const frameId = finitePositiveInteger(status.framesRendered)

  if (iosurfaceId === null || width === null || height === null || frameId === null) {
    return null
  }

  return {
    iosurfaceId,
    width,
    height,
    frameId,
    runId: typeof status.runId === 'string' && status.runId.length > 0 ? status.runId : undefined
  }
}

export function nativeCametalLayerStatusMatchesHandoff(
  status: PreviewSurfaceStatus,
  handoff: NativePreviewMetalTargetHandoff
): boolean {
  const presentedFrameId = finitePositiveInteger(status.presentedFrameId)
  return (
    status.state === 'live' &&
    status.transport === 'native-surface' &&
    status.backing === 'cametal-layer' &&
    status.sourcePixelsPresent &&
    presentedFrameId !== null &&
    presentedFrameId >= handoff.frameId
  )
}

export function realSurfaceUnavailableMessage(
  handoff: NativePreviewMetalTargetHandoff,
  unavailableReason = 'Real CAMetalLayer IOSurface presenter is not installed'
): string {
  return [
    `${unavailableReason};`,
    `falling back to Electron proof surface for compositor frame ${handoff.frameId}`,
    `(${handoff.width}x${handoff.height}, IOSurface ${handoff.iosurfaceId}${handoff.runId ? `, run ${handoff.runId}` : ''}).`
  ].join(' ')
}

export function realSurfaceInvalidActivationMessage(
  handoff: NativePreviewMetalTargetHandoff,
  status?: PreviewSurfaceStatus | null
): string {
  const details = status
    ? [
        `status=${status.state}/${status.transport}/${status.backing}`,
        `presented=${status.presentedFrameId ?? 'none'}`,
        `sourcePixels=${status.sourcePixelsPresent ? 'true' : 'false'}`
      ].join(', ')
    : 'status=none'
  return [
    'Real CAMetalLayer presenter did not confirm a native on-screen present;',
    `falling back to Electron proof surface for compositor frame ${handoff.frameId}`,
    `(${details}).`
  ].join(' ')
}

export function proofSurfaceCompositorMessage(
  status: PreviewSurfaceCompositorUpdateParams,
  realSurfaceFallbackReason?: string
): string | undefined {
  const proofMessage =
    status.state === 'live' ? 'Electron proof preview surface is displaying compositor output.' : status.message
  return realSurfaceFallbackReason ? `${realSurfaceFallbackReason} ${proofMessage ?? ''}`.trim() : proofMessage
}

function finitePositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}
