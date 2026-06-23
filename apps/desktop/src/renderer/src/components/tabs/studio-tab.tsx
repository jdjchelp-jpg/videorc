import {
  Broadcast,
  CheckCircle,
  FolderOpen,
  Record,
  StopCircle,
  WarningCircle
} from '@phosphor-icons/react'
import { useEffect, useRef, useState, type ReactElement } from 'react'

import { BlockingBanner } from '@/components/blocking-banner'
import { LiveChatRail } from '@/components/live-chat-rail'
import { PreviewStage } from '@/components/preview-stage'
import { SessionStrip } from '@/components/session-strip'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Kbd } from '@/components/ui/kbd'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { type StudioPanel, type WorkspaceTab } from '@/components/workspace-nav'
import { useStudio } from '@/hooks/use-studio'
import type { GoLiveDestinationPreflight, StreamPlatform, StreamPrivacy } from '@/lib/backend'
import { videoProfileCompatibility } from '@/lib/capture'
import { goLiveEntitlementGate, type EntitlementUiGate } from '@/lib/entitlement-ui'
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
            <div className="flex min-w-0 flex-col">
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
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive">
            <WarningCircle className="size-4 shrink-0" weight="fill" />
            <span className="min-w-0">{previewHealth.detail}</span>
          </div>
        ) : null}
        {!active && liveStreamBlockedReason ? (
          <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning-foreground dark:text-warning">
            <WarningCircle className="size-4 shrink-0" weight="fill" />
            <span>{liveStreamBlockedReason}</span>
          </div>
        ) : null}
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
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
    <div className="flex shrink-0 items-center gap-2 rounded-xl border bg-muted/30 px-2 py-1.5">
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

function GoLiveConfirmationDialog({
  open,
  pending,
  partialSetup,
  preflight,
  entitlementGate,
  draft,
  onPatchDraft,
  onCancel,
  onConfirm,
  onContinuePartial,
  onResolveBlocker
}: {
  open: boolean
  pending: boolean
  partialSetup: ReturnType<typeof useStudio>['goLivePartialSetup']
  preflight: ReturnType<typeof useStudio>['goLivePreflight']
  entitlementGate: EntitlementUiGate
  draft: ReturnType<typeof useStudio>['streamMetadataDraft']
  onPatchDraft: ReturnType<typeof useStudio>['patchStreamMetadataDraft']
  onCancel: () => void
  onConfirm: () => void
  onContinuePartial: () => void
  onResolveBlocker: (targetId: string, resolution: 'disable' | 'manual-rtmp') => void
}): ReactElement {
  const entitlementBlocker = entitlementGate.allowed ? null : entitlementGate
  const entitlementUpgradeUrl = entitlementBlocker?.upgradeUrl
  const errorCount = preflight?.issues.filter((issue) => issue.severity === 'error').length ?? 0
  const entitlementIssueCount =
    entitlementBlocker &&
    !preflight?.issues.some((issue) => issue.message === entitlementBlocker.reason)
      ? 1
      : 0
  const issueCount = errorCount + entitlementIssueCount
  // "Resolve before going live" means exactly that: error-severity issues keep
  // the confirm button locked until resolved (disable the destination, switch
  // it to Manual RTMP, or fix it in the Streaming tab).
  const blocked = Boolean(entitlementBlocker) || (preflight ? !preflight.valid : false)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-h-[88vh] gap-4 overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Confirm Go Live</DialogTitle>
          <DialogDescription>
            Review destinations and metadata before Videogre starts the livestream.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-3">
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="go-live-title">Title</FieldLabel>
                <Input
                  id="go-live-title"
                  disabled={pending || !draft}
                  value={draft?.title ?? ''}
                  onChange={(event) => onPatchDraft({ title: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="go-live-description">Description</FieldLabel>
                <textarea
                  className="min-h-20 rounded-md border bg-background px-3 py-2 text-sm outline-none transition focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={pending || !draft}
                  id="go-live-description"
                  value={draft?.description ?? ''}
                  onChange={(event) => onPatchDraft({ description: event.target.value })}
                />
              </Field>
            </div>

            <Field>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FieldLabel>Default privacy</FieldLabel>
                {draft?.defaultPrivacy && draft.defaultPrivacy !== 'public' ? (
                  <Badge variant="warning">Not public</Badge>
                ) : null}
              </div>
              <Select
                disabled={pending || !draft}
                value={draft?.defaultPrivacy ?? 'private'}
                onValueChange={(value) => onPatchDraft({ defaultPrivacy: value as StreamPrivacy })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">Private</SelectItem>
                  <SelectItem value="unlisted">Unlisted</SelectItem>
                  <SelectItem value="public">Public</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>
                {draft?.defaultPrivacy === 'public'
                  ? 'YouTube will be discoverable from the channel while live.'
                  : 'YouTube will not be discoverable from the channel while live.'}
              </FieldDescription>
            </Field>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">Destinations</span>
                {issueCount ? (
                  <Badge variant="destructive">
                    {issueCount} issue{issueCount === 1 ? '' : 's'}
                  </Badge>
                ) : (
                  <Badge variant="success">Ready</Badge>
                )}
              </div>
              <div className="grid gap-2">
                {preflight?.destinations.length ? (
                  preflight.destinations.map((destination) => (
                    <GoLiveDestinationRow
                      destination={destination}
                      key={destination.targetId}
                      pending={pending}
                      onResolveBlocker={onResolveBlocker}
                    />
                  ))
                ) : (
                  <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                    No livestream destinations are enabled.
                  </div>
                )}
              </div>
            </div>

            {entitlementBlocker ? (
              <div className="flex flex-col gap-2 rounded-md border border-warning/35 bg-warning/10 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-warning-foreground dark:text-warning">
                  <WarningCircle className="size-4" weight="fill" />
                  {entitlementUpgradeUrl ? 'Premium issue' : 'Streaming entitlement issue'}
                </div>
                <p className="text-sm text-muted-foreground">{entitlementBlocker.reason}</p>
                {entitlementUpgradeUrl ? (
                  <Button
                    className="w-fit"
                    size="sm"
                    variant="outline"
                    onClick={() => openExternalUrl(entitlementUpgradeUrl)}
                  >
                    View Premium
                  </Button>
                ) : null}
              </div>
            ) : null}

            {preflight?.issues.length ? (
              <div className="flex flex-col gap-2 rounded-md border border-destructive/25 bg-destructive/5 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                  <WarningCircle className="size-4" weight="fill" />
                  Resolve before going live
                </div>
                <ul className="grid gap-1.5 text-sm text-muted-foreground">
                  {preflight.issues.map((issue, index) => (
                    <li key={`${issue.platform ?? 'global'}-${issue.targetId ?? 'all'}-${index}`}>
                      {issue.platform ? `${platformLabel(issue.platform)}: ` : ''}
                      {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {partialSetup ? (
              <div className="flex flex-col gap-2 rounded-md border border-warning/35 bg-warning/10 p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <WarningCircle className="size-4 text-warning" weight="fill" />
                  Some destinations failed setup
                </div>
                <ul className="grid gap-1.5 text-sm text-muted-foreground">
                  {partialSetup.failures.map((failure) => (
                    <li key={failure.targetId}>
                      {platformLabel(failure.platform)}: {failure.label} - {failure.message}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Ready: {partialSetup.readyLabels.join(', ')}
                </p>
              </div>
            ) : null}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button disabled={pending} variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          {partialSetup ? (
            <Button disabled={pending || Boolean(entitlementBlocker)} onClick={onContinuePartial}>
              <Broadcast data-icon="inline-start" weight="fill" />
              {pending ? 'Starting…' : 'Continue With Ready'}
            </Button>
          ) : (
            <Button disabled={pending || !preflight || blocked} onClick={onConfirm}>
              <Broadcast data-icon="inline-start" weight="fill" />
              {pending ? 'Checking…' : blocked ? 'Resolve Blockers First' : 'Confirm Go Live'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function openExternalUrl(url: string): void {
  const opener = window.videorc?.openOAuthUrl
  if (opener) {
    void opener(url)
    return
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}

function GoLiveDestinationRow({
  destination,
  pending,
  onResolveBlocker
}: {
  destination: GoLiveDestinationPreflight
  pending: boolean
  onResolveBlocker: (targetId: string, resolution: 'disable' | 'manual-rtmp') => void
}): ReactElement {
  return (
    <div className="grid gap-2 rounded-md border bg-muted/25 p-3 sm:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{destination.label}</span>
          <Badge variant={destination.ready ? 'success' : 'destructive'}>
            {destination.ready ? (
              <CheckCircle data-icon="inline-start" weight="fill" />
            ) : (
              <WarningCircle data-icon="inline-start" weight="fill" />
            )}
            {destination.ready ? 'Ready' : 'Blocked'}
          </Badge>
          <Badge variant="outline">
            {destination.authMode === 'oauth' ? 'OAuth' : 'Manual RTMP'}
          </Badge>
        </div>
        <p className="mt-1 truncate text-sm text-muted-foreground">
          {destination.title || 'Untitled'}
        </p>
        {destination.accountLabel ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{destination.accountLabel}</p>
        ) : null}
        {!destination.ready ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {destination.authMode === 'oauth' ? (
              <Button
                disabled={pending}
                size="sm"
                variant="outline"
                onClick={() => onResolveBlocker(destination.targetId, 'manual-rtmp')}
              >
                Switch to Manual RTMP
              </Button>
            ) : null}
            <Button
              disabled={pending}
              size="sm"
              variant="outline"
              onClick={() => onResolveBlocker(destination.targetId, 'disable')}
            >
              Go live without {destination.label}
            </Button>
          </div>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground sm:max-w-64 sm:text-right">
        {destination.message}
      </p>
    </div>
  )
}

function platformLabel(platform: StreamPlatform): string {
  switch (platform) {
    case 'youtube':
      return 'YouTube'
    case 'twitch':
      return 'Twitch'
    case 'x':
      return 'X'
    case 'custom':
      return 'Custom RTMP'
  }
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
