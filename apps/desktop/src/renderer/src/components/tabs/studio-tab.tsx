import { Broadcast, FolderOpen, Record, StopCircle, WarningCircle } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type ReactElement } from 'react'

import { BlockingBanner } from '@/components/blocking-banner'
import { GoLiveConfirmationDialog } from '@/components/go-live-dialog'
import { LiveChatRail } from '@/components/live-chat-rail'
import { PreviewStage } from '@/components/preview-stage'
import { SessionStrip } from '@/components/session-strip'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { type StudioPanel, type WorkspaceTab } from '@/components/workspace-nav'
import { useStudio } from '@/hooks/use-studio'
import { videoProfileCompatibility } from '@/lib/capture'
import { goLiveEntitlementGate } from '@/lib/entitlement-ui'
import { entitlementDisabledReason } from '@/lib/entitlements'
import { studioHealth } from '@/lib/studio-health'
import { cn } from '@/lib/utils'

export function StudioTab(): ReactElement {
  const studio = useStudio()
  const {
    recording,
    elapsed,
    canStop,
    startRequestPending,
    stopRequestPending,
    visibleStartBlockedReason,
    startSession,
    stopSession,
    captureConfig,
    setCaptureConfig,
    entitlements,
    previewLiveStatus,
    previewSurfaceStatus,
    nativePreviewSurfaceEnabled,
    refreshPreview,
    openPreviewPermissions,
    wsStatus,
    health,
    diagnosticStats,
    goLiveConfirmationOpen,
    goLiveConfirmationPending,
    goLivePartialSetup,
    goLivePreflight,
    streamMetadataDraft,
    patchStreamMetadataDraft,
    cancelGoLiveConfirmation,
    confirmGoLive,
    continueGoLiveWithReadyDestinations,
    resolveGoLiveBlocker
  } = studio

  const active = recording.state === 'recording' || recording.state === 'streaming'
  const previewHealth = studioHealth(diagnosticStats, active)
  const banner = studioBlocker(studio)
  const liveStreamCompatibility = videoProfileCompatibility({
    ...captureConfig,
    streamEnabled: true
  })
  const liveStreamEntitlementReason = entitlementDisabledReason(entitlements, 'livestreaming')
  const goLiveEntitlement = goLiveEntitlementGate({
    entitlements,
    streaming: captureConfig.streaming
  })
  const goLiveEntitlementBlocker = goLiveEntitlement.allowed ? null : goLiveEntitlement
  const liveStreamBlockedReason =
    liveStreamEntitlementReason ??
    goLiveEntitlementBlocker?.reason ??
    liveStreamCompatibility.blockingReason
  const recordCompatibility = videoProfileCompatibility({
    ...captureConfig,
    recordEnabled: true,
    streamEnabled: false
  })
  const recordBlockedReason =
    wsStatus !== 'connected'
      ? `Backend socket is ${wsStatus}.`
      : recordCompatibility.blockingReason
        ? recordCompatibility.blockingReason
        : !health
          ? 'Checking FFmpeg before starting.'
          : !health.ffmpeg.available
            ? (health.ffmpeg.message ?? 'FFmpeg is not available.')
            : null

  // Live-only chat rail (ux-ia plan, slice 6): exists ONLY while streaming.
  // Auto-opens once when chat providers attach; ⌘J toggles; state resets when
  // the session ends — off-air the Studio has no chat surface.
  const streamingActive = recording.state === 'streaming'
  const chatProvidersAttached = studio.liveChatSnapshot.providers.length > 0
  const [chatRailOpen, setChatRailOpen] = useState(false)
  const chatAutoOpened = useRef(false)
  useEffect(() => {
    if (!streamingActive) {
      chatAutoOpened.current = false
      setChatRailOpen(false)
      return
    }
    if (chatProvidersAttached && !chatAutoOpened.current) {
      chatAutoOpened.current = true
      setChatRailOpen(true)
    }
  }, [streamingActive, chatProvidersAttached])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() === 'j' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        if (streamingActive) {
          setChatRailOpen((value) => !value)
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [streamingActive])

  // Two-button start: set the intended mode, then start on the next render so startSession
  // sees the updated streamEnabled (record vs go-live) instead of a stale closure value.
  const [pendingStart, setPendingStart] = useState(false)
  useEffect(() => {
    if (!pendingStart) {
      return
    }
    setPendingStart(false)
    void startSession()
  }, [pendingStart, startSession])

  const handleRecord = (): void => {
    setCaptureConfig((current) => ({ ...current, recordEnabled: true, streamEnabled: false }))
    setPendingStart(true)
  }
  const handleLiveStream = (): void => {
    if (liveStreamBlockedReason) {
      return
    }
    setCaptureConfig((current) => ({ ...current, streamEnabled: true }))
    setPendingStart(true)
  }

  const stopLabel = stopRequestPending
    ? 'Stopping…'
    : recording.state === 'stopping'
      ? 'Force stop'
      : recording.state === 'streaming'
        ? 'End livestream'
        : 'Stop recording'

  return (
    <div className="flex items-start gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <GoLiveConfirmationDialog
          draft={streamMetadataDraft}
          entitlementGate={goLiveEntitlement}
          open={goLiveConfirmationOpen}
          pending={goLiveConfirmationPending || startRequestPending}
          preflight={goLivePreflight}
          partialSetup={goLivePartialSetup}
          onCancel={cancelGoLiveConfirmation}
          onConfirm={() => void confirmGoLive()}
          onContinuePartial={() => void continueGoLiveWithReadyDestinations()}
          onPatchDraft={patchStreamMetadataDraft}
          onResolveBlocker={(targetId, resolution) =>
            void resolveGoLiveBlocker(targetId, resolution)
          }
        />

        {visibleStartBlockedReason && banner ? (
          <BlockingBanner
            description={visibleStartBlockedReason}
            jumpLabel={banner.jumpLabel}
            jumpTo={banner.jumpTo}
            title={banner.title}
            tone="warning"
          />
        ) : null}

        {/* Session command module in the stage header (top-right). It reuses the
            existing record/stop/go-live handlers — no second session state
            machine — and replaces the old below-preview transport (A7). */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={cn(
                'size-2.5 shrink-0 rounded-full',
                recording.state === 'recording' && 'bg-destructive',
                recording.state === 'streaming' && 'bg-success',
                (recording.state === 'starting' || recording.state === 'stopping') && 'bg-warning',
                recording.state === 'failed' && 'bg-destructive',
                recording.state === 'idle' && 'bg-muted-foreground/40',
                active && 'animate-pulse'
              )}
            />
            {/* Live region: recording state is otherwise visual-only (the dot +
                label). Announce idle→recording→streaming→stopped/failed so screen
                readers know when capture actually starts and stops. */}
            <div aria-atomic="true" aria-live="polite" className="flex min-w-0 flex-col">
              <span className="text-sm font-semibold capitalize">{recording.state}</span>
              <span className="truncate text-xs text-muted-foreground">
                {recording.message ?? 'Idle'}
              </span>
            </div>
            {previewHealth.tone !== 'neutral' ? (
              <StatusBadge label="Preview" tone={previewHealth.tone} value={previewHealth.value} />
            ) : null}
          </div>
          <StudioSessionModule
            active={active}
            canStop={canStop}
            elapsed={elapsed}
            liveStreamBlockedReason={liveStreamBlockedReason}
            recordBlockedReason={recordBlockedReason}
            startRequestPending={startRequestPending}
            stopLabel={stopLabel}
            wsStatus={wsStatus}
            onLiveStream={handleLiveStream}
            onRecord={handleRecord}
            onStop={stopSession}
          />
        </div>

        {previewHealth.tone === 'error' && previewHealth.detail ? (
          <div className="flex items-center gap-2 rounded-row border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive">
            <WarningCircle className="size-4 shrink-0" weight="fill" />
            <span className="min-w-0">{previewHealth.detail}</span>
          </div>
        ) : null}
        {!active && liveStreamBlockedReason ? (
          <div className="flex items-center gap-2 rounded-row border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning-foreground dark:text-warning">
            <WarningCircle className="size-4 shrink-0" weight="fill" />
            <span>{liveStreamBlockedReason}</span>
          </div>
        ) : null}
        <div className="flex items-center gap-2 rounded-row border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <FolderOpen className="size-4 shrink-0" weight="duotone" />
          <span className="truncate">
            {recording.outputPath ?? recording.streamUrl ?? 'Output appears after session start.'}
          </span>
        </div>

        {/* Big preview below the command module. */}
        <PreviewStage
          onOpenPermissions={openPreviewPermissions}
          onRetry={refreshPreview}
          previewLiveStatus={previewLiveStatus}
          previewSurfaceStatus={previewSurfaceStatus}
          nativePreviewSurfaceEnabled={nativePreviewSurfaceEnabled}
        />

        {/* Session strip: every former accordion is now a chip that shows
            state and deep-links to its owning page (ux-ia plan, slice 5). */}
        <SessionStrip />
      </div>

      {chatRailOpen && streamingActive ? (
        <LiveChatRail
          snapshot={studio.liveChatSnapshot}
          onClearLocal={studio.clearLiveChat}
          onClose={() => setChatRailOpen(false)}
        />
      ) : null}
    </div>
  )
}

// Compact top-right session command module (A7). Pure presentation: it calls the
// same handlers StudioTab already owns (record/go-live set the mode then start;
// Go Live still flows through the existing preflight dialog), so there is no
// second session state machine. Blocked reasons surface as the button title.
function StudioSessionModule({
  active,
  canStop,
  elapsed,
  startRequestPending,
  stopLabel,
  recordBlockedReason,
  liveStreamBlockedReason,
  wsStatus,
  onRecord,
  onLiveStream,
  onStop
}: {
  active: boolean
  canStop: boolean
  elapsed: string
  startRequestPending: boolean
  stopLabel: string
  recordBlockedReason: string | null
  liveStreamBlockedReason: string | null
  wsStatus: string
  onRecord: () => void
  onLiveStream: () => void
  onStop: () => void
}): ReactElement {
  return (
    <div className="flex shrink-0 items-center gap-2 rounded-row border bg-muted/30 px-2 py-1.5">
      {active ? (
        <>
          <time className="px-1.5 font-heading text-lg font-semibold tabular-nums">{elapsed}</time>
          <Button disabled={!canStop} size="sm" variant="destructive" onClick={onStop}>
            <StopCircle data-icon="inline-start" weight="fill" />
            {stopLabel}
            <Kbd className="ml-1.5">␣</Kbd>
          </Button>
        </>
      ) : (
        <>
          <Button
            disabled={Boolean(recordBlockedReason) || startRequestPending}
            size="sm"
            title={recordBlockedReason ?? 'Record to a file (Space)'}
            variant="destructive"
            onClick={onRecord}
          >
            <Record data-icon="inline-start" weight="fill" />
            {startRequestPending ? 'Starting…' : 'Record'}
            <Kbd className="ml-1.5">␣</Kbd>
          </Button>
          <Button
            disabled={
              wsStatus !== 'connected' || startRequestPending || Boolean(liveStreamBlockedReason)
            }
            size="sm"
            title={liveStreamBlockedReason ?? 'Start livestream'}
            variant="outline"
            onClick={onLiveStream}
          >
            <Broadcast data-icon="inline-start" weight="fill" />
            Go Live
          </Button>
        </>
      )}
    </div>
  )
}

function studioBlocker(studio: ReturnType<typeof useStudio>): {
  title: string
  jumpTo?: WorkspaceTab | StudioPanel
  jumpLabel?: string
} | null {
  const { wsStatus, outputEnabled, captureConfig, streamReady, health, entitlements } = studio
  const goLiveEntitlement = captureConfig.streamEnabled
    ? goLiveEntitlementGate({ entitlements, streaming: captureConfig.streaming })
    : { allowed: true as const }

  if (wsStatus !== 'connected') {
    return { title: 'Backend not connected' }
  }
  if (!outputEnabled) {
    return { title: 'No output enabled', jumpTo: 'recording', jumpLabel: 'Open Recording' }
  }
  if (captureConfig.streamEnabled && !goLiveEntitlement.allowed) {
    return {
      title: goLiveEntitlement.upgradeUrl ? 'Premium required' : 'Streaming limit reached',
      jumpTo: 'live',
      jumpLabel: 'Open Live'
    }
  }
  if (captureConfig.streamEnabled && !streamReady) {
    return { title: 'Stream target incomplete', jumpTo: 'live', jumpLabel: 'Open Live' }
  }
  if (health && !health.ffmpeg.available) {
    return { title: 'FFmpeg unavailable', jumpTo: 'settings', jumpLabel: 'Open Settings' }
  }
  return { title: 'Finish setup to start' }
}
