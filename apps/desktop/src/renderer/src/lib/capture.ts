import type {
  LayoutSettings,
  RtmpPreset,
  SourceSelection,
  VideoPreset,
  VideoSettings
} from '../../../shared/backend'

export type SettingsState = {
  outputDirectory: string
  ffmpegPath: string
}

export type CaptureConfig = {
  sources: SourceSelection
  layout: LayoutSettings
  video: VideoSettings
  recordEnabled: boolean
  streamEnabled: boolean
  rtmpPreset: RtmpPreset
  rtmpServerUrl: string
  streamKey: string
}

export type WsStatus = 'waiting' | 'connecting' | 'connected' | 'failed' | 'closed'
export type SetupTone = 'good' | 'warn' | 'neutral'
export type SetupStep = {
  label: string
  detail: string
  tone: SetupTone
}

export const STORAGE_KEYS = {
  settings: 'videorc.settings',
  captureConfig: 'videorc.captureConfig',
  onboarding: 'videorc.onboardingComplete',
  theme: 'videorc.theme'
} as const

export const ONBOARDING_VERSION = 'creator-ux-v1'

export const defaultSettings: SettingsState = {
  outputDirectory: '',
  ffmpegPath: ''
}

export const rtmpDefaults: Record<RtmpPreset, string> = {
  youtube: 'rtmp://a.rtmp.youtube.com/live2',
  twitch: 'rtmp://live.twitch.tv/app',
  x: '',
  custom: ''
}

export const videoPresets: Record<VideoPreset, VideoSettings> = {
  'tutorial-1080p30': {
    preset: 'tutorial-1080p30',
    width: 1920,
    height: 1080,
    fps: 30,
    bitrateKbps: 6000
  },
  'tutorial-1440p30': {
    preset: 'tutorial-1440p30',
    width: 2560,
    height: 1440,
    fps: 30,
    bitrateKbps: 8000
  },
  'stream-1080p60': {
    preset: 'stream-1080p60',
    width: 1920,
    height: 1080,
    fps: 60,
    bitrateKbps: 9000
  },
  custom: {
    preset: 'custom',
    width: 1920,
    height: 1080,
    fps: 30,
    bitrateKbps: 6000
  }
}

export const defaultCaptureConfig: CaptureConfig = {
  sources: {},
  layout: {
    cameraCorner: 'bottom-right',
    cameraSize: 'medium',
    cameraShape: 'rectangle',
    cameraMargin: 32,
    cameraFit: 'fill',
    cameraMirror: false,
    cameraZoom: 100,
    cameraOffsetX: 0,
    cameraOffsetY: 0
  },
  video: videoPresets['tutorial-1440p30'],
  recordEnabled: true,
  streamEnabled: false,
  rtmpPreset: 'youtube',
  rtmpServerUrl: rtmpDefaults.youtube,
  streamKey: ''
}

export function loadJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key)
  if (!raw) {
    return fallback
  }

  try {
    return { ...fallback, ...(JSON.parse(raw) as Partial<T>) }
  } catch {
    return fallback
  }
}

export function loadCaptureConfig(): CaptureConfig {
  const loaded = loadJson(STORAGE_KEYS.captureConfig, defaultCaptureConfig) as Partial<CaptureConfig>

  return {
    ...defaultCaptureConfig,
    ...loaded,
    sources: { ...defaultCaptureConfig.sources, ...(loaded.sources ?? {}) },
    layout: normalizeLayoutSettings(loaded.layout),
    video: normalizeVideoSettings(loaded.video),
    recordEnabled:
      typeof loaded.recordEnabled === 'boolean' ? loaded.recordEnabled : defaultCaptureConfig.recordEnabled,
    streamEnabled:
      typeof loaded.streamEnabled === 'boolean' ? loaded.streamEnabled : defaultCaptureConfig.streamEnabled,
    rtmpPreset: loaded.rtmpPreset ?? defaultCaptureConfig.rtmpPreset,
    rtmpServerUrl: loaded.rtmpServerUrl ?? defaultCaptureConfig.rtmpServerUrl,
    streamKey: loaded.streamKey ?? defaultCaptureConfig.streamKey
  }
}

export function normalizeLayoutSettings(layout: unknown): LayoutSettings {
  const candidate = layout && typeof layout === 'object' ? (layout as Partial<LayoutSettings>) : {}

  return {
    ...defaultCaptureConfig.layout,
    ...candidate,
    cameraMargin: clampNumber(candidate.cameraMargin, defaultCaptureConfig.layout.cameraMargin, 8, 96),
    cameraZoom: clampNumber(candidate.cameraZoom, defaultCaptureConfig.layout.cameraZoom, 100, 200),
    cameraOffsetX: clampNumber(candidate.cameraOffsetX, defaultCaptureConfig.layout.cameraOffsetX, -100, 100),
    cameraOffsetY: clampNumber(candidate.cameraOffsetY, defaultCaptureConfig.layout.cameraOffsetY, -100, 100),
    cameraMirror:
      typeof candidate.cameraMirror === 'boolean' ? candidate.cameraMirror : defaultCaptureConfig.layout.cameraMirror,
    cameraFit:
      candidate.cameraFit === 'fit' || candidate.cameraFit === 'fill'
        ? candidate.cameraFit
        : defaultCaptureConfig.layout.cameraFit
  }
}

export function normalizeVideoSettings(video: unknown): VideoSettings {
  const candidate = video && typeof video === 'object' ? (video as Partial<VideoSettings>) : {}
  const preset =
    typeof candidate.preset === 'string' && candidate.preset in videoPresets
      ? (candidate.preset as VideoPreset)
      : defaultCaptureConfig.video.preset
  const fallback = videoPresets[preset]

  return {
    preset,
    width: clampNumber(candidate.width, fallback.width, 640, 3840),
    height: clampNumber(candidate.height, fallback.height, 360, 2160),
    fps: clampNumber(candidate.fps, fallback.fps, 24, 60),
    bitrateKbps: clampNumber(candidate.bitrateKbps, fallback.bitrateKbps, 1000, 50000)
  }
}

export function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(max, Math.max(min, Math.round(parsed)))
}
