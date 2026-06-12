import {
  Broadcast,
  ChatCircle,
  CheckCircle,
  FolderOpen,
  type Icon,
  Record,
  StopCircle,
  WarningCircle
} from '@phosphor-icons/react'
import { useEffect, useState, type ReactElement } from 'react'

import { BlockingBanner } from '@/components/blocking-banner'
import { LiveChatPanel } from '@/components/live-chat-panel'
import { PreviewStage } from '@/components/preview-stage'
import { SessionStrip } from '@/components/session-strip'
import { StatusBadge } from '@/components/status-badge'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@/components/ui/accordion'
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
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { type StudioPanel, type WorkspaceTab } from '@/components/workspace-nav'
import { useStudio } from '@/hooks/use-studio'
import type { GoLiveDestinationPreflight, StreamPlatform } from '@/lib/backend'
import { videoProfileCompatibility } from '@/lib/capture'
import { studioHealth } from '@/lib/studio-health'
import { cn } from '@/lib/utils'

export function StudioTab(): ReactElement {
  const studio = useStudio()
  const {
    recording,
    elapsed,
    canStart,
    canStop,
    startRequestPending,
    stopRequestPending,
    startBlockedReason,
    visibleStartBlockedReason,
    startSession,
    stopSession,
    captureConfig,
    setCaptureConfig,
    previewLiveStatus,
    previewSurfaceStatus,
    nativePreviewSurfaceEnabled,
    refreshPreview,
    openPreviewPermissions,
    wsStatus,
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
  const liveStreamBlockedReason = liveStreamCompatibility.blockingReason

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
    <div className="flex flex-col gap-4">
      <GoLiveConfirmationDialog
        draft={streamMetadataDraft}
        open={goLiveConfirmationOpen}
        pending={goLiveConfirmationPending || startRequestPending}
        preflight={goLivePreflight}
        partialSetup={goLivePartialSetup}
        onCancel={cancelGoLiveConfirmation}
        onConfirm={() => void confirmGoLive()}
        onContinuePartial={() => void continueGoLiveWithReadyDestinations()}
        onPatchDraft={patchStreamMetadataDraft}
        onResolveBlocker={(targetId, resolution) => void resolveGoLiveBlocker(targetId, resolution)}
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

      {/* Big preview on top */}
      <PreviewStage
        onOpenPermissions={openPreviewPermissions}
        onRetry={refreshPreview}
        previewLiveStatus={previewLiveStatus}
        previewSurfaceStatus={previewSurfaceStatus}
        nativePreviewSurfaceEnabled={nativePreviewSurfaceEnabled}
      />

      {/* Action bar: status + the two primary buttons + output */}
      <div className="flex flex-col gap-3 rounded-2xl border bg-muted/20 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
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
            <div className="flex flex-col">
              <span className="text-sm font-semibold capitalize">{recording.state}</span>
              <span className="text-xs text-muted-foreground">{recording.message ?? 'Idle'}</span>
            </div>
            {previewHealth.tone !== 'neutral' ? (
              <StatusBadge label="Preview" tone={previewHealth.tone} value={previewHealth.value} />
            ) : null}
          </div>
          <time className="font-heading text-2xl font-semibold tabular-nums">{elapsed}</time>
        </div>

        {previewHealth.tone === 'error' && previewHealth.detail ? (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive">
            <WarningCircle className="size-4 shrink-0" weight="fill" />
            <span className="min-w-0">{previewHealth.detail}</span>
          </div>
        ) : null}

        {active ? (
          <Button size="lg" variant="destructive" disabled={!canStop} onClick={stopSession}>
            <StopCircle data-icon="inline-start" weight="fill" />
            {stopLabel}
            <Kbd className="ml-1.5">␣</Kbd>
          </Button>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              size="lg"
              variant="outline"
              disabled={!canStart || startRequestPending}
              title={startBlockedReason ?? 'Record to a file (Space)'}
              onClick={handleRecord}
            >
              <Record data-icon="inline-start" weight="fill" />
              {startRequestPending ? 'Starting…' : 'Record'}
              <Kbd className="ml-1.5">␣</Kbd>
            </Button>
            <Button
              size="lg"
              variant="outline"
              disabled={
                wsStatus !== 'connected' || startRequestPending || Boolean(liveStreamBlockedReason)
              }
              title={liveStreamBlockedReason ?? 'Start livestream'}
              onClick={handleLiveStream}
            >
              <Broadcast data-icon="inline-start" weight="fill" />
              Live Stream
            </Button>
          </div>
        )}
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
      </div>

      {/* Session strip: every former accordion is now a chip that shows
          state and deep-links to its owning page (ux-ia plan, slice 5). */}
      <SessionStrip />

      <Accordion type="multiple" className="bg-muted/20">
        <AccordionItem value="chat">
          <AccordionTrigger>
            <SectionLabel icon={ChatCircle} title="Live chat" />
          </AccordionTrigger>
          <AccordionContent className="flex flex-col gap-3.5">
            <LiveChatPanel snapshot={studio.liveChatSnapshot} onClearLocal={studio.clearLiveChat} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}

function SectionLabel({
  icon: LeadingIcon,
  title,
  summary
}: {
  icon: Icon
  title: string
  summary?: string
}): ReactElement {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <LeadingIcon className="size-4 shrink-0 text-muted-foreground" weight="duotone" />
      <span className="font-medium">{title}</span>
      {summary ? (
        <span className="min-w-0 truncate text-xs font-normal text-muted-foreground">
          {summary}
        </span>
      ) : null}
    </span>
  )
}

function GoLiveConfirmationDialog({
  open,
  pending,
  partialSetup,
  preflight,
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
  draft: ReturnType<typeof useStudio>['streamMetadataDraft']
  onPatchDraft: ReturnType<typeof useStudio>['patchStreamMetadataDraft']
  onCancel: () => void
  onConfirm: () => void
  onContinuePartial: () => void
  onResolveBlocker: (targetId: string, resolution: 'disable' | 'manual-rtmp') => void
}): ReactElement {
  const errorCount = preflight?.issues.filter((issue) => issue.severity === 'error').length ?? 0
  // "Resolve before going live" means exactly that: error-severity issues keep
  // the confirm button locked until resolved (disable the destination, switch
  // it to Manual RTMP, or fix it in the Streaming tab).
  const blocked = preflight ? !preflight.valid : false

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

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">Destinations</span>
                {errorCount ? (
                  <Badge variant="destructive">
                    {errorCount} issue{errorCount === 1 ? '' : 's'}
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
            <Button disabled={pending} onClick={onContinuePartial}>
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
  const { wsStatus, outputEnabled, captureConfig, streamReady, health } = studio

  if (wsStatus !== 'connected') {
    return { title: 'Backend not connected' }
  }
  if (!outputEnabled) {
    return { title: 'No output enabled', jumpTo: 'recording', jumpLabel: 'Open Recording' }
  }
  if (captureConfig.streamEnabled && !streamReady) {
    return { title: 'Stream target incomplete', jumpTo: 'live', jumpLabel: 'Open Live' }
  }
  if (health && !health.ffmpeg.available) {
    return { title: 'FFmpeg unavailable', jumpTo: 'settings', jumpLabel: 'Open Settings' }
  }
  return { title: 'Finish setup to start' }
}
