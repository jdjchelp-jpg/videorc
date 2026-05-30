import { Broadcast, FileVideo, Monitor, ShieldCheck } from '@phosphor-icons/react'
import type { ReactElement, ReactNode } from 'react'

import logoUrl from '@/assets/videogre-logo.png'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useStudio } from '@/hooks/use-studio'

export function OnboardingDialog({
  open,
  onComplete
}: {
  open: boolean
  onComplete: () => void
}): ReactElement {
  const { health, settings } = useStudio()

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onComplete()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <img alt="Videogre" className="mb-1 size-16 object-contain" src={logoUrl} />
          <DialogTitle>Welcome to Videogre</DialogTitle>
          <DialogDescription>An AI-native studio for recording, streaming, and publishing.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Step icon={FileVideo} title="Local-first recordings">
            Sessions are recorded to MKV on your machine. Nothing uploads automatically.
          </Step>
          <Step icon={ShieldCheck} title="Cloud AI is opt-in">
            Transcripts, summaries, and chapters only run after you grant consent in the AI tab.
          </Step>
          <Step icon={Monitor} title="Grant macOS permissions">
            Allow screen recording, camera, and microphone access so devices appear in Sources.
          </Step>
          <Step icon={Broadcast} title="Streaming is optional">
            Add a YouTube, Twitch, X, or custom RTMP target in Outputs whenever you want to go live.
          </Step>
        </div>

        <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          FFmpeg: {health?.ffmpeg.available ? (health.ffmpeg.version ?? 'available') : (health?.ffmpeg.message ?? 'checking…')}
          {' · '}
          Output: {settings.outputDirectory.trim() || 'default location'}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onComplete}>
            Skip
          </Button>
          <Button onClick={onComplete}>Get started</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Step({ icon: Icon, title, children }: { icon: typeof Monitor; title: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 size-5 shrink-0 text-primary" weight="duotone" />
      <div className="flex flex-col">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-sm text-muted-foreground">{children}</span>
      </div>
    </div>
  )
}
