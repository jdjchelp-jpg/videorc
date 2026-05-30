import { ArrowClockwise, CheckCircle, Database, GearSix, Pulse, Warning } from '@phosphor-icons/react'
import { useTheme } from 'next-themes'
import type { ReactElement } from 'react'

import { PanelSection } from '@/components/panel-section'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useStudio } from '@/hooks/use-studio'
import type { HealthEvent, RtmpPreset, VideoPreset } from '@/lib/backend'
import { compactTime } from '@/lib/format'
import { cn } from '@/lib/utils'

export function SettingsTab({ onResetOnboarding }: { onResetOnboarding: () => void }): ReactElement {
  const {
    settings,
    setSettings,
    health,
    captureConfig,
    applyVideoPreset,
    applyRtmpPreset,
    healthEvents,
    logs
  } = useStudio()
  const { theme, setTheme } = useTheme()

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <PanelSection description="Where recordings are written and which FFmpeg binary is used." icon={GearSix} title="Storage & tools">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="output-directory">Output directory</FieldLabel>
            <Input
              id="output-directory"
              placeholder="~/Movies/Videorc/Recordings"
              value={settings.outputDirectory}
              onChange={(event) => setSettings((current) => ({ ...current, outputDirectory: event.target.value }))}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="ffmpeg-path">FFmpeg path</FieldLabel>
            <Input
              id="ffmpeg-path"
              placeholder="ffmpeg"
              value={settings.ffmpegPath}
              onChange={(event) => setSettings((current) => ({ ...current, ffmpegPath: event.target.value }))}
            />
            <FieldDescription className="flex items-center gap-1.5">
              {health?.ffmpeg.available ? (
                <CheckCircle className="size-3.5 text-success" weight="fill" />
              ) : (
                <Warning className="size-3.5 text-warning" weight="fill" />
              )}
              {health?.ffmpeg.version ?? health?.ffmpeg.message ?? 'Waiting for FFmpeg status.'}
            </FieldDescription>
          </Field>
        </FieldGroup>
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Database className="size-4 shrink-0" weight="duotone" />
          <span className="truncate">{health?.databasePath ?? 'Waiting for SQLite path.'}</span>
        </div>
      </PanelSection>

      <PanelSection description="Defaults applied to new capture sessions." icon={GearSix} title="Defaults">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="default-preset">Default recording preset</FieldLabel>
            <Select value={captureConfig.video.preset} onValueChange={(value) => applyVideoPreset(value as VideoPreset)}>
              <SelectTrigger className="w-full" id="default-preset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="tutorial-1440p30">Tutorial 1440p30</SelectItem>
                  <SelectItem value="tutorial-1080p30">Tutorial 1080p30</SelectItem>
                  <SelectItem value="stream-1080p60">Stream 1080p60</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="default-rtmp">Default RTMP preset</FieldLabel>
            <Select value={captureConfig.rtmpPreset} onValueChange={(value) => applyRtmpPreset(value as RtmpPreset)}>
              <SelectTrigger className="w-full" id="default-rtmp">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="youtube">YouTube</SelectItem>
                  <SelectItem value="twitch">Twitch</SelectItem>
                  <SelectItem value="x">X / Twitter</SelectItem>
                  <SelectItem value="custom">Custom RTMP</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Theme</FieldLabel>
            <ToggleGroup
              type="single"
              value={theme ?? 'system'}
              variant="outline"
              onValueChange={(value) => value && setTheme(value)}
            >
              <ToggleGroupItem value="light">Light</ToggleGroupItem>
              <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
              <ToggleGroupItem value="system">System</ToggleGroupItem>
            </ToggleGroup>
          </Field>
        </FieldGroup>
        <div>
          <Button size="sm" variant="outline" onClick={onResetOnboarding}>
            <ArrowClockwise data-icon="inline-start" />
            Replay onboarding
          </Button>
        </div>
      </PanelSection>

      <PanelSection
        className="lg:col-span-2"
        description="Deterministic health events and raw backend logs."
        icon={Pulse}
        title="Diagnostics"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Health events</h3>
            {healthEvents.length === 0 ? (
              <Empty className="border-0 py-6">
                <EmptyTitle>No health events yet</EmptyTitle>
              </Empty>
            ) : (
              <ScrollArea className="h-64 pr-3">
                <div className="flex flex-col gap-1.5">
                  {healthEvents.map((event) => (
                    <HealthRow event={event} key={event.id} />
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Backend log</h3>
            {logs.length === 0 ? (
              <Empty className="border-0 py-6">
                <EmptyTitle>Waiting for backend logs</EmptyTitle>
              </Empty>
            ) : (
              <ScrollArea className="h-64 pr-3">
                <div className="flex flex-col gap-1 font-mono text-xs">
                  {logs.map((log, index) => (
                    <div className="flex gap-2" key={`${log.timestamp}-${index}`}>
                      <time className="shrink-0 text-muted-foreground">{compactTime(log.timestamp)}</time>
                      <span
                        className={cn(
                          'shrink-0 uppercase',
                          log.level === 'error' && 'text-destructive',
                          log.level === 'warn' && 'text-warning'
                        )}
                      >
                        {log.level}
                      </span>
                      <p className="min-w-0 break-words">{log.message}</p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>
      </PanelSection>
    </div>
  )
}

function HealthRow({ event }: { event: HealthEvent }): ReactElement {
  const tone = event.level === 'error' ? 'error' : event.level === 'warn' ? 'warn' : 'neutral'

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2">
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-medium">{event.code}</span>
        <span className="text-xs text-muted-foreground">{event.message}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StatusBadge tone={tone} value={event.level} />
        <time className="text-xs text-muted-foreground">{compactTime(event.createdAt)}</time>
      </div>
    </div>
  )
}
