import {
  Broadcast,
  FilmReel,
  GearSix,
  Microphone,
  Monitor,
  Record,
  Sparkle,
  SquaresFour,
  VideoCamera,
  type Icon
} from '@phosphor-icons/react'
import { createContext, useContext } from 'react'

// Full pages: they replace the workspace content area.
export type WorkspaceTab = 'studio' | 'library' | 'ai' | 'diagnostics' | 'settings'

// Studio panels: live controls that open in a push rail BESIDE the studio so the
// glued preview stays visible while operating (Studio Shell And Live Control Plan,
// slice C1). The studio slot resizes; panels never overlap it.
export type StudioPanel = 'layouts' | 'live' | 'audio' | 'recording' | 'screens'

export type WorkspaceTabGroup = 'primary' | 'system'

export type WorkspaceTabMeta = {
  id: WorkspaceTab
  label: string
  icon: Icon
  group: WorkspaceTabGroup
}

export type StudioPanelMeta = {
  id: StudioPanel
  label: string
  icon: Icon
  // The pre-rail tab id; kept as the `data-videorc-tab-trigger` value so smokes and
  // automation keep working across the C1 shell change.
  legacyTabId: string
}

export const WORKSPACE_TABS: WorkspaceTabMeta[] = [
  { id: 'studio', label: 'Studio', icon: VideoCamera, group: 'primary' },
  { id: 'library', label: 'Library', icon: FilmReel, group: 'primary' },
  { id: 'ai', label: 'AI', icon: Sparkle, group: 'primary' },
  { id: 'settings', label: 'Settings', icon: GearSix, group: 'system' }
]

// Sidebar order mirrors the live workflow: composition, going live, sound, output.
// `screens` is temporary — it folds into the Layouts panel in slice C2.
export const STUDIO_PANELS: StudioPanelMeta[] = [
  { id: 'layouts', label: 'Layouts', icon: SquaresFour, legacyTabId: 'layout' },
  { id: 'live', label: 'Live', icon: Broadcast, legacyTabId: 'streaming' },
  { id: 'audio', label: 'Audio', icon: Microphone, legacyTabId: 'sources' },
  { id: 'recording', label: 'Recording', icon: Record, legacyTabId: 'recording' },
  { id: 'screens', label: 'Screens', icon: Monitor, legacyTabId: 'screens' }
]

export const WORKSPACE_GROUPS: { id: WorkspaceTabGroup; label?: string }[] = [
  { id: 'primary' },
  { id: 'system' }
]

export function isStudioPanel(value: unknown): value is StudioPanel {
  return STUDIO_PANELS.some((panel) => panel.id === value)
}

type WorkspaceNavValue = {
  active: WorkspaceTab
  setActive: (tab: WorkspaceTab) => void
  activeStudioPanel: StudioPanel | null
  openStudioPanel: (panel: StudioPanel) => void
  closeStudioPanel: () => void
}

export const WorkspaceNavContext = createContext<WorkspaceNavValue | null>(null)

export function useWorkspaceNav(): WorkspaceNavValue {
  const value = useContext(WorkspaceNavContext)
  if (!value) {
    throw new Error('useWorkspaceNav must be used within a WorkspaceNavContext provider')
  }
  return value
}
