import { ThemeProvider } from 'next-themes'
import type { ReactElement } from 'react'

import { AppShell } from '@/components/app-shell'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { StudioProvider } from '@/hooks/use-studio'
import { STORAGE_KEYS } from '@/lib/capture'

export function App(): ReactElement {
  return (
    <ThemeProvider
      attribute="class"
      // Dark glass is the design's default expression; light stays one toggle
      // away as its structural twin (videorc-design skill).
      defaultTheme="dark"
      enableSystem
      storageKey={STORAGE_KEYS.theme}
    >
      <TooltipProvider>
        <StudioProvider>
          <AppShell />
          <Toaster richColors position="bottom-right" />
        </StudioProvider>
      </TooltipProvider>
    </ThemeProvider>
  )
}
