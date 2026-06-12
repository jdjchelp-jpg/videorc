import {
  Broadcast,
  CaretDown,
  ImageSquare,
  Layout,
  Microphone,
  Monitor,
  Record,
  SpeakerHigh,
  SpeakerSlash,
  type Icon
} from '@phosphor-icons/react'
import type { ReactElement } from 'react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { useWorkspaceNav } from '@/components/workspace-nav'
import { useStudio } from '@/hooks/use-studio'
import type { LayoutPreset } from '@/lib/backend'
import { isStreamTargetStartReady } from '@/lib/capture'
import { cn } from '@/lib/utils'

// The Studio session strip (ux-ia plan, slice 5): one row of stateful chips
// replacing the old accordions. A chip SHOWS state and deep-links to the page
// that owns it; the only inline affordances are the genuinely mid-session
// actions — mic mute, live-safe layout preset switch, screen takeover.
const CHIP_CLASS =
  'flex min-w-0 items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm transition-colors hover:bg-muted/50'

const LAYOUT_QUICK_PRESETS: { id: LayoutPreset; label: string; needsCamera: boolean }[] = [
  { id: 'screen-camera', label: 'Screen + Cam', needsCamera: false },
  { id: 'screen-only', label: 'Screen', needsCamera: false },
  { id: 'camera-only', label: 'Camera', needsCamera: true },
  { id: 'side-by-side', label: 'Side by side', needsCamera: true }
]

function presetLabel(preset: LayoutPreset): string {
  return LAYOUT_QUICK_PRESETS.find((entry) => entry.id === preset)?.label ?? preset
}

function Chip({
  icon: ChipIcon,
  title,
  detail,
  onClick
}: {
  icon: Icon
  title: string
  detail: string
  onClick: () => void
}): ReactElement {
  return (
    <button className={CHIP_CLASS} type="button" onClick={onClick}>
      <ChipIcon className="size-4 shrink-0 text-muted-foreground" weight="duotone" />
      <span className="shrink-0 font-medium">{title}</span>
      <span className="min-w-0 max-w-48 truncate text-xs text-muted-foreground">{detail}</span>
    </button>
  )
}

export function SessionStrip(): ReactElement {
  const {
    captureConfig,
    setCaptureConfig,
    selectedCaptureDevice,
    selectedCamera,
    selectedMicrophone,
    screens,
    activeScreen,
    activateScreen,
    clearActiveScreen,
    applyCameraPreset,
    layoutSwitchPending,
    platformAccounts,
    wsStatus
  } = useStudio()
  const { openStudioPanel } = useWorkspaceNav()

  const sourceDetail = [
    selectedCaptureDevice?.name ?? 'No screen',
    selectedCamera ? selectedCamera.name : 'no cam'
  ].join(' · ')

  const muted = captureConfig.audio.microphoneMuted
  const hasCamera = Boolean(captureConfig.sources.cameraId)
  const MuteIcon = muted ? SpeakerSlash : SpeakerHigh

  const destinationChips = captureConfig.streaming.targets
    .filter((target) => target.enabled)
    .map((target) => {
      const account =
        target.authMode === 'oauth'
          ? platformAccounts.find((candidate) => candidate.platform === target.platform)
          : undefined
      const ready =
        target.authMode === 'oauth' ? Boolean(account) : isStreamTargetStartReady(target)
      return {
        id: target.id,
        label: target.label || target.platform,
        detail:
          target.authMode === 'oauth'
            ? account
              ? (account.accountLabel ?? 'connected')
              : 'no account'
            : target.streamKeyPresent || target.streamKeySecretRef
              ? 'key saved'
              : 'no key',
        ready
      }
    })

  const outputDetail = [
    `${captureConfig.video.width}×${captureConfig.video.height}`,
    `${captureConfig.video.fps}fps`,
    captureConfig.recordEnabled ? 'MP4' : 'stream-only'
  ].join(' · ')

  return (
    <div className="flex flex-wrap items-stretch gap-2">
      <Chip
        detail={sourceDetail}
        icon={Monitor}
        title="Source"
        onClick={() => openStudioPanel('sources')}
      />

      {/* Mic: name navigates, mute toggles inline (a mid-session action). */}
      <div className={cn(CHIP_CLASS, 'gap-1.5 py-0 pr-1.5')}>
        <button
          className="flex min-w-0 items-center gap-2 py-2"
          type="button"
          onClick={() => openStudioPanel('sources')}
        >
          <Microphone className="size-4 shrink-0 text-muted-foreground" weight="duotone" />
          <span className="shrink-0 font-medium">Mic</span>
          <span className="min-w-0 max-w-40 truncate text-xs text-muted-foreground">
            {selectedMicrophone?.name ?? 'Off'}
          </span>
        </button>
        {selectedMicrophone ? (
          <Button
            aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
            aria-pressed={muted}
            className="size-7"
            size="icon"
            title={muted ? 'Unmute microphone' : 'Mute microphone'}
            variant="ghost"
            onClick={() =>
              setCaptureConfig((current) => ({
                ...current,
                audio: { ...current.audio, microphoneMuted: !current.audio.microphoneMuted }
              }))
            }
          >
            <MuteIcon className={cn('size-4', muted && 'text-warning')} weight="fill" />
          </Button>
        ) : null}
      </div>

      {/* Layout: the one deliberate two-home control — switching presets is a
          mid-session action, so the popover IS the in-session control; the
          Scene page stays the editor. */}
      <Popover>
        <PopoverTrigger className={CHIP_CLASS}>
          <Layout className="size-4 shrink-0 text-muted-foreground" weight="duotone" />
          <span className="shrink-0 font-medium">Layout</span>
          <span className="min-w-0 max-w-40 truncate text-xs text-muted-foreground">
            {layoutSwitchPending ? 'Switching…' : presetLabel(captureConfig.layout.layoutPreset)}
          </span>
          <CaretDown className="size-3 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-2">
          <div className="grid grid-cols-2 gap-1.5">
            {LAYOUT_QUICK_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                disabled={layoutSwitchPending !== null || (preset.needsCamera && !hasCamera)}
                size="sm"
                variant={
                  captureConfig.layout.layoutPreset === preset.id ? 'secondary' : 'outline'
                }
                onClick={() => applyCameraPreset({ layoutPreset: preset.id })}
              >
                {layoutSwitchPending === preset.id ? 'Switching…' : preset.label}
              </Button>
            ))}
          </div>
          <Separator className="my-2" />
          <Button
            className="w-full justify-start"
            size="sm"
            variant="ghost"
            onClick={() => openStudioPanel('layouts')}
          >
            Edit scene
          </Button>
        </PopoverContent>
      </Popover>

      {/* Takeover: hidden until Screens exist; switching is live-safe. */}
      {screens.length > 0 ? (
        <Popover>
          <PopoverTrigger className={CHIP_CLASS}>
            <ImageSquare className="size-4 shrink-0 text-muted-foreground" weight="duotone" />
            <span className="shrink-0 font-medium">Takeover</span>
            <span className="min-w-0 max-w-40 truncate text-xs text-muted-foreground">
              {activeScreen?.name ?? 'Normal'}
            </span>
            <CaretDown className="size-3 shrink-0 text-muted-foreground" />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-2">
            <div className="flex flex-col gap-1.5">
              <Button
                disabled={wsStatus !== 'connected'}
                size="sm"
                variant={activeScreen ? 'outline' : 'secondary'}
                onClick={() => void clearActiveScreen()}
              >
                Normal
              </Button>
              {screens.map((screen) => {
                const selected = activeScreen?.id === screen.id
                const missing = screen.status === 'missing'
                return (
                  <Button
                    key={screen.id}
                    className="justify-start"
                    disabled={missing || wsStatus !== 'connected'}
                    size="sm"
                    title={missing ? 'Screen image is missing' : screen.name}
                    variant={selected ? 'secondary' : 'outline'}
                    onClick={() =>
                      void (selected ? clearActiveScreen() : activateScreen(screen.id))
                    }
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-5 w-8 shrink-0 overflow-hidden rounded border bg-muted">
                        {!missing ? (
                          <img
                            alt=""
                            className="size-full object-cover"
                            src={fileUrlFromPath(screen.imagePath)}
                          />
                        ) : (
                          <span className="block size-full bg-destructive/20" />
                        )}
                      </span>
                      <span className="min-w-0 truncate">{screen.name}</span>
                    </span>
                  </Button>
                )
              })}
            </div>
            <Separator className="my-2" />
            <Button
              className="w-full justify-start"
              size="sm"
              variant="ghost"
              onClick={() => openStudioPanel('layouts')}
            >
              Manage Screens
            </Button>
          </PopoverContent>
        </Popover>
      ) : null}

      {destinationChips.map((chip) => (
        <button
          className={CHIP_CLASS}
          key={chip.id}
          type="button"
          onClick={() => openStudioPanel('live')}
        >
          <Broadcast className="size-4 shrink-0 text-muted-foreground" weight="duotone" />
          <span className={cn('size-1.5 rounded-full', chip.ready ? 'bg-success' : 'bg-warning')} />
          <span className="shrink-0 font-medium capitalize">{chip.label}</span>
          <span className="min-w-0 max-w-40 truncate text-xs text-muted-foreground">
            {chip.detail}
          </span>
        </button>
      ))}

      <Chip
        detail={outputDetail}
        icon={Record}
        title="Output"
        onClick={() => openStudioPanel('recording')}
      />
    </div>
  )
}

function fileUrlFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const prefix = /^[A-Za-z]:/.test(normalized) ? 'file:///' : 'file://'
  return `${prefix}${encodeURI(normalized)}`
}
