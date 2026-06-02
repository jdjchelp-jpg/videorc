import {
  Broadcast,
  CheckCircle,
  Gauge,
  TwitchLogo,
  WarningCircle,
  XLogo,
  YoutubeLogo,
  type Icon
} from '@phosphor-icons/react'
import type { ReactElement } from 'react'

import { PanelSection } from '@/components/panel-section'
import { Badge } from '@/components/ui/badge'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useStudio } from '@/hooks/use-studio'
import type { StreamPlatform, StreamTargetSettings, StreamUrlMode } from '@/lib/backend'
import { isStreamTargetReady } from '@/lib/capture'

const PLATFORM_ICON: Record<StreamPlatform, Icon> = {
  youtube: YoutubeLogo,
  twitch: TwitchLogo,
  x: XLogo,
  custom: Broadcast
}

export function StreamingTab(): ReactElement {
  const { captureConfig, patchStreamingTarget, health, isSessionActive } = useStudio()
  const streaming = captureConfig.streaming
  const { video } = captureConfig

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        {isSessionActive ? (
          <p className="text-sm text-muted-foreground">
            Destination credentials are locked while a session is live.
          </p>
        ) : null}
        {streaming.targets.map((target) => (
          <DestinationCard
            disabled={isSessionActive}
            key={target.id}
            target={target}
            onPatch={patchStreamingTarget}
          />
        ))}
      </div>

      <StreamingReadiness
        bitrateKbps={video.bitrateKbps}
        ffmpegReady={Boolean(health?.ffmpeg.available)}
        recordEnabled={captureConfig.recordEnabled}
        targets={streaming.targets}
        video={`${video.width}×${video.height} @ ${video.fps}`}
      />
    </div>
  )
}

function DestinationCard({
  target,
  disabled,
  onPatch
}: {
  target: StreamTargetSettings
  disabled: boolean
  onPatch: (targetId: string, patch: Partial<StreamTargetSettings>) => void
}): ReactElement {
  const ready = isStreamTargetReady(target)
  const fullUrl = target.urlMode === 'full-url'
  const badge: { tone: 'success' | 'warning' | 'outline'; label: string } = target.enabled
    ? ready
      ? { tone: 'success', label: 'Ready' }
      : { tone: 'warning', label: 'Needs setup' }
    : { tone: 'outline', label: 'Off' }

  return (
    <PanelSection
      action={
        <Switch
          aria-label={`Enable ${target.label}`}
          checked={target.enabled}
          disabled={disabled}
          onCheckedChange={(checked) => onPatch(target.id, { enabled: checked })}
        />
      }
      icon={PLATFORM_ICON[target.platform]}
      title={target.label}
    >
      <Badge className="w-fit" variant={badge.tone}>
        {badge.label}
      </Badge>

      {target.platform === 'custom' ? (
        <Field>
          <FieldLabel>URL mode</FieldLabel>
          <ToggleGroup
            className="w-full"
            disabled={disabled}
            type="single"
            value={target.urlMode ?? 'server-and-key'}
            variant="outline"
            onValueChange={(value) => value && onPatch(target.id, { urlMode: value as StreamUrlMode })}
          >
            <ToggleGroupItem value="server-and-key">Server + key</ToggleGroupItem>
            <ToggleGroupItem value="full-url">Full URL</ToggleGroupItem>
          </ToggleGroup>
        </Field>
      ) : null}

      <Field>
        <FieldLabel htmlFor={`${target.id}-server`}>{fullUrl ? 'Full RTMP URL' : 'RTMP server'}</FieldLabel>
        <Input
          disabled={disabled}
          id={`${target.id}-server`}
          placeholder={fullUrl ? 'rtmp://server/app/key' : 'rtmp://server/app'}
          value={target.serverUrl}
          onChange={(event) => onPatch(target.id, { serverUrl: event.target.value })}
        />
      </Field>

      {!fullUrl ? (
        <Field>
          <FieldLabel htmlFor={`${target.id}-key`}>Stream key</FieldLabel>
          <Input
            autoComplete="off"
            disabled={disabled}
            id={`${target.id}-key`}
            placeholder="paste your stream key"
            type="password"
            value={target.streamKey}
            onChange={(event) => onPatch(target.id, { streamKey: event.target.value })}
          />
          <FieldDescription>
            Saved locally per platform — switching platforms never overwrites another key.
          </FieldDescription>
        </Field>
      ) : null}

      {target.platform === 'x' ? (
        <p className="text-xs text-muted-foreground">
          X needs Media Studio Producer access; copy the RTMP URL and key from a Producer source.
        </p>
      ) : null}
    </PanelSection>
  )
}

function StreamingReadiness({
  targets,
  bitrateKbps,
  ffmpegReady,
  recordEnabled,
  video
}: {
  targets: StreamTargetSettings[]
  bitrateKbps: number
  ffmpegReady: boolean
  recordEnabled: boolean
  video: string
}): ReactElement {
  const enabled = targets.filter((target) => target.enabled)
  const readyCount = enabled.filter(isStreamTargetReady).length
  const allReady = enabled.length > 0 && readyCount === enabled.length
  const presetOk = bitrateKbps <= 6000
  const uploadMbps = enabled.length
    ? Math.round((((bitrateKbps + 128) * enabled.length * 1.1) / 1000) * 10) / 10
    : 0
  const diskMbPerMin = Math.round((bitrateKbps / 8 / 1000) * 60)

  return (
    <PanelSection icon={Gauge} title="Multistream readiness">
      <ChecklistRow
        detail={enabled.length ? `${readyCount}/${enabled.length} ready` : 'No destinations enabled'}
        label="Destination credentials saved"
        ok={allReady}
      />
      <ChecklistRow
        detail={`${video} · ${bitrateKbps} kbps${presetOk ? '' : ' · exceeds Twitch ~6000'}`}
        label="Output preset compatible"
        ok={presetOk}
      />
      <ChecklistRow detail={ffmpegReady ? 'ready' : 'check Settings'} label="FFmpeg available" ok={ffmpegReady} />
      <InfoRow
        detail={
          enabled.length
            ? `~${uploadMbps} Mbps to ${enabled.length} destination${enabled.length > 1 ? 's' : ''}`
            : '—'
        }
        label="Estimated upload"
      />
      {recordEnabled ? <InfoRow detail={`~${diskMbPerMin} MB/min`} label="Estimated disk" /> : null}

      <p className="text-xs text-muted-foreground">
        v1 streams the same encode to every destination via FFmpeg, so the bitrate is capped by the
        strictest platform (Twitch ~6000 kbps).
      </p>
    </PanelSection>
  )
}

function ChecklistRow({ label, detail, ok }: { label: string; detail: string; ok: boolean }): ReactElement {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <div className="flex items-center gap-2">
        {ok ? (
          <CheckCircle className="size-4 shrink-0 text-primary" weight="fill" />
        ) : (
          <WarningCircle className="size-4 shrink-0 text-muted-foreground" weight="fill" />
        )}
        <span>{label}</span>
      </div>
      <span className="text-right text-xs text-muted-foreground">{detail}</span>
    </div>
  )
}

function InfoRow({ label, detail }: { label: string; detail: string }): ReactElement {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-xs tabular-nums">{detail}</span>
    </div>
  )
}
