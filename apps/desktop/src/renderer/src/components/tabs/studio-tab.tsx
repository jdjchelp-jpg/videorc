import { Broadcast, FolderOpen, Play, Record, SpeakerHigh, SpeakerSlash, StopCircle } from '@phosphor-icons/react'
import type { ReactElement } from 'react'

import { BlockingBanner } from '@/components/blocking-banner'
import { PanelSection } from '@/components/panel-section'
import { PreviewStage } from '@/components/preview-stage'
import { StatusBadge, type StatusTone } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Field, FieldContent, FieldLabel } from '@/components/ui/field'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useStudio } from '@/hooks/use-studio'
import { cn } from '@/lib/utils'

const STATE_TONE: Record<string, StatusTone> = {
  idle: 'neutral',
  starting: 'warn',
  recording: 'error',
  streaming: 'good',
  stopping: 'warn',
  failed: 'error'
}

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
    previewUrl,
    previewLoading,
    previewLiveStatus,
    refreshPreview,
    openPreviewPermissions,
    revealPermissionTarget,
    runtimeInfo,
    selectedCaptureDevice,
    selectedCamera,
    selectedMicrophone,
    streamReady,
    wsStatus,
    health,
    audioMeter,
    meterLevel,
    scene,
    sceneEditMode,
    selectedSceneSourceId,
    setSceneEditMode,
    setSelectedSceneSourceId
  } = studio

  const active = recording.state === 'recording' || recording.state === 'streaming'
  const banner = studioBlocker(studio)
  const audioSummary =
    recording.audioTracks?.map((track) => track.label).join(' + ') ?? (selectedMicrophone ? 'Microphone' : 'None')
  const pipelineSummary = recording.pipeline ? pipelineStatusLabel(recording.pipeline.finalization) : 'Ready'
  const startLabel = startButtonLabel(captureConfig.recordEnabled, captureConfig.streamEnabled)

  return (
    <div className="flex flex-col gap-4">
      {visibleStartBlockedReason && banner ? (
        <BlockingBanner
          description={visibleStartBlockedReason}
          jumpLabel={banner.jumpLabel}
          jumpTo={banner.jumpTo}
          title={banner.title}
          tone="warning"
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <PreviewStage
          layout={captureConfig.layout}
          onOpenPermissions={openPreviewPermissions}
          onRevealPermissionTarget={revealPermissionTarget}
          onRetry={refreshPreview}
          previewLiveStatus={previewLiveStatus}
          previewLoading={previewLoading}
          previewUrl={previewUrl}
          runtimeInfo={runtimeInfo}
          scene={scene}
          sceneEditMode={sceneEditMode}
          selectedSceneSourceId={selectedSceneSourceId}
          onSelectSceneSource={setSelectedSceneSourceId}
        />

        <div className="flex flex-col gap-4">
          <PanelSection icon={Record} title="Session">
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
              </div>
              <time className="font-heading text-2xl font-semibold tabular-nums">{elapsed}</time>
            </div>

            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={!canStart}
                size="lg"
                title={startBlockedReason ?? 'Start session'}
                onClick={startSession}
              >
                <Play data-icon="inline-start" weight="fill" />
                {startRequestPending ? 'Starting…' : startLabel}
              </Button>
              <Button
                className="flex-1"
                disabled={!canStop}
                size="lg"
                variant="destructive"
                onClick={stopSession}
              >
                <StopCircle data-icon="inline-start" weight="fill" />
                {stopRequestPending ? 'Stopping…' : recording.state === 'stopping' ? 'Force stop' : 'Stop'}
              </Button>
            </div>

            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <FolderOpen className="size-4 shrink-0" weight="duotone" />
              <span className="truncate">
                {recording.outputPath ?? recording.streamUrl ?? 'Output appears after session start.'}
              </span>
            </div>

            <Separator />

            <div className="flex flex-col gap-3">
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="studio-edit-mode">Edit transforms</FieldLabel>
                </FieldContent>
                <Switch checked={sceneEditMode} id="studio-edit-mode" onCheckedChange={setSceneEditMode} />
              </Field>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="studio-record">Record MKV</FieldLabel>
                </FieldContent>
                <Switch
                  checked={captureConfig.recordEnabled}
                  id="studio-record"
                  onCheckedChange={(checked) =>
                    setCaptureConfig((current) => ({ ...current, recordEnabled: checked }))
                  }
                />
              </Field>
            </div>
          </PanelSection>

          <PanelSection icon={selectedMicrophone ? SpeakerHigh : SpeakerSlash} title="Mixer">
            <MixerRow
              gainDb={captureConfig.audio.microphoneGainDb}
              meterLevel={meterLevel}
              muted={captureConfig.audio.microphoneMuted}
              peakDb={audioMeter?.peakDb}
              selectedMicrophoneName={selectedMicrophone?.name}
              syncOffsetMs={captureConfig.audio.microphoneSyncOffsetMs}
            />
          </PanelSection>

          <PanelSection icon={Broadcast} title="Live summary">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <SummaryRow label="Screen" value={selectedCaptureDevice?.name ?? 'None'} />
              <SummaryRow label="Camera" value={selectedCamera?.name ?? 'Off'} />
              <SummaryRow label="Audio" value={audioSummary} />
              <SummaryRow
                label="Output"
                value={`${captureConfig.video.width}×${captureConfig.video.height} · ${captureConfig.video.fps}fps`}
              />
              <SummaryRow
                label="Mode"
                value={[captureConfig.recordEnabled && 'Record', captureConfig.streamEnabled && 'Stream']
                  .filter(Boolean)
                  .join(' + ') || 'None'}
              />
              <SummaryRow label="Pipeline" value={pipelineSummary} />
            </dl>
            <Separator />
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge label="Socket" tone={wsStatus === 'connected' ? 'good' : 'warn'} value={wsStatus} />
              <StatusBadge
                label="FFmpeg"
                tone={health?.ffmpeg.available ? 'good' : 'warn'}
                value={health?.ffmpeg.available ? 'ready' : 'check'}
              />
              {captureConfig.streamEnabled ? (
                <StatusBadge label="Stream" tone={streamReady ? 'good' : 'warn'} value={streamReady ? 'ready' : 'setup'} />
              ) : null}
            </div>
          </PanelSection>
        </div>
      </div>
    </div>
  )
}

function MixerRow({
  selectedMicrophoneName,
  meterLevel,
  gainDb,
  muted,
  peakDb,
  syncOffsetMs
}: {
  selectedMicrophoneName?: string
  meterLevel: number
  gainDb: number
  muted: boolean
  peakDb?: number
  syncOffsetMs: number
}): ReactElement {
  const meterTone = muted ? 'bg-muted-foreground/30' : meterLevel > 2 ? 'bg-success' : 'bg-warning'

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate text-muted-foreground">
          {selectedMicrophoneName ?? 'No microphone selected'}
        </span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {muted ? 'Muted' : `${gainDb > 0 ? '+' : ''}${gainDb} dB`}
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all', meterTone)}
          style={{ width: `${Math.min(100, Math.max(0, meterLevel))}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Source meter</span>
        <span>{typeof peakDb === 'number' ? `${peakDb.toFixed(1)} dB` : 'Not checked'}</span>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Sync</span>
        <span>{`${syncOffsetMs > 0 ? '+' : ''}${syncOffsetMs} ms`}</span>
      </div>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right font-medium">{value}</dd>
    </>
  )
}

function pipelineStatusLabel(status: string): string {
  switch (status) {
    case 'finalizing':
      return 'Finalizing'
    case 'finalized':
      return 'Finalized'
    case 'failed':
      return 'Failed'
    default:
      return 'Running'
  }
}

function startButtonLabel(recordEnabled: boolean, streamEnabled: boolean): string {
  if (recordEnabled && streamEnabled) {
    return 'Start Livestream + Record'
  }
  if (streamEnabled) {
    return 'Start Livestream'
  }
  if (recordEnabled) {
    return 'Start Recording'
  }
  return 'Start Session'
}

function studioBlocker(studio: ReturnType<typeof useStudio>): {
  title: string
  jumpTo?: 'sources' | 'recording' | 'streaming' | 'settings'
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
    return { title: 'Stream target incomplete', jumpTo: 'streaming', jumpLabel: 'Open Streaming' }
  }
  if (health && !health.ffmpeg.available) {
    return { title: 'FFmpeg unavailable', jumpTo: 'settings', jumpLabel: 'Open Settings' }
  }
  return { title: 'Finish setup to start' }
}
