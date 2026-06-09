import { useCallback, useEffect, useState, type ReactElement } from 'react'

import { CommandPalette } from '@/components/command-palette'
import { OnboardingDialog } from '@/components/onboarding-dialog'
import { Sidebar } from '@/components/sidebar'
import type { StatusDotTone } from '@/components/status-dot'
import { StudioPanelRail } from '@/components/studio-panel-rail'
import { AiTab } from '@/components/tabs/ai-tab'
import { DiagnosticsTab } from '@/components/tabs/diagnostics-tab'
import { LibraryTab } from '@/components/tabs/library-tab'
import { SettingsTab } from '@/components/tabs/settings-tab'
import { StudioTab } from '@/components/tabs/studio-tab'
import {
  WorkspaceNavContext,
  isStudioPanel,
  type StudioPanel,
  type WorkspaceTab
} from '@/components/workspace-nav'
import { useStudio } from '@/hooks/use-studio'
import { ONBOARDING_VERSION, STORAGE_KEYS } from '@/lib/capture'

export function AppShell(): ReactElement {
  const { connection, wsStatus, recording, refreshBackend } = useStudio()
  const [active, setActive] = useState<WorkspaceTab>('studio')
  const [studioPanel, setStudioPanel] = useState<StudioPanel | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [commandOpen, setCommandOpen] = useState(false)
  const [onboardingOpen, setOnboardingOpen] = useState(
    () => localStorage.getItem(STORAGE_KEYS.onboarding) !== ONBOARDING_VERSION
  )

  // Opening a panel always lands in the studio: panels are live controls beside the
  // preview, not pages. Clicking the open panel's entry again closes it.
  const openStudioPanel = useCallback((panel: StudioPanel) => {
    setActive('studio')
    setStudioPanel((current) => (current === panel ? null : panel))
  }, [])

  const closeStudioPanel = useCallback(() => {
    setStudioPanel(null)
  }, [])

  const completeOnboarding = useCallback(
    (target?: WorkspaceTab | StudioPanel) => {
      localStorage.setItem(STORAGE_KEYS.onboarding, ONBOARDING_VERSION)
      setOnboardingOpen(false)
      if (isStudioPanel(target)) {
        openStudioPanel(target)
      } else if (target) {
        setActive(target)
      }
    },
    [openStudioPanel]
  )

  const resetOnboarding = useCallback(() => {
    localStorage.removeItem(STORAGE_KEYS.onboarding)
    setOnboardingOpen(true)
  }, [])

  const openInAi = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId)
    setActive('ai')
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setCommandOpen((value) => !value)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const live = recording.state === 'recording' || recording.state === 'streaming'
  const statusTone: StatusDotTone = live
    ? 'error'
    : connection && wsStatus === 'connected'
      ? 'good'
      : wsStatus === 'failed'
        ? 'error'
        : 'warn'
  const statusLabel = live ? recording.state : wsStatus

  return (
    <WorkspaceNavContext.Provider
      value={{
        active,
        setActive,
        activeStudioPanel: active === 'studio' ? studioPanel : null,
        openStudioPanel,
        closeStudioPanel
      }}
    >
      <div className="flex min-h-screen bg-background text-foreground" data-videorc-active-tab={active}>
        <Sidebar
          active={active}
          activeStudioPanel={active === 'studio' ? studioPanel : null}
          onSelect={setActive}
          onSelectStudioPanel={openStudioPanel}
          statusTone={statusTone}
          statusLabel={statusLabel}
          live={live}
          onRefresh={refreshBackend}
          onOpenCommand={() => setCommandOpen(true)}
        />

        {active === 'studio' ? (
          <main className="flex h-screen flex-1 overflow-hidden">
            {studioPanel ? <StudioPanelRail panel={studioPanel} onClose={closeStudioPanel} /> : null}
            <div className="flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-[1600px] px-8 py-6">
                <StudioTab />
              </div>
            </div>
          </main>
        ) : (
          <main className="flex h-screen flex-1 flex-col overflow-y-auto">
            <div className="mx-auto w-full max-w-[1600px] flex-1 px-8 py-6">
              {active === 'library' ? <LibraryTab onOpenInAi={openInAi} /> : null}
              {active === 'ai' ? (
                <AiTab selectedSessionId={selectedSessionId} setSelectedSessionId={setSelectedSessionId} />
              ) : null}
              {active === 'diagnostics' ? <DiagnosticsTab /> : null}
              {active === 'settings' ? <SettingsTab onResetOnboarding={resetOnboarding} /> : null}
            </div>
          </main>
        )}

        <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
        <OnboardingDialog open={onboardingOpen} onComplete={completeOnboarding} />
      </div>
    </WorkspaceNavContext.Provider>
  )
}
