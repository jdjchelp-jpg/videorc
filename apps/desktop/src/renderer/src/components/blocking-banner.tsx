import { ArrowRight, Warning, type Icon } from '@phosphor-icons/react'
import type { ReactElement, ReactNode } from 'react'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  isStudioPanel,
  useWorkspaceNav,
  type StudioPanel,
  type WorkspaceTab
} from '@/components/workspace-nav'

export type BannerTone = 'warning' | 'destructive' | 'success' | 'default'

export function BlockingBanner({
  tone = 'warning',
  title,
  description,
  icon: LeadingIcon = Warning,
  jumpTo,
  jumpLabel
}: {
  tone?: BannerTone
  title: string
  description?: ReactNode
  icon?: Icon
  jumpTo?: WorkspaceTab | StudioPanel
  jumpLabel?: string
}): ReactElement {
  const { setActive, openStudioPanel } = useWorkspaceNav()

  return (
    <Alert variant={tone}>
      <LeadingIcon weight="fill" />
      <AlertTitle>{title}</AlertTitle>
      {description ? <AlertDescription>{description}</AlertDescription> : null}
      {jumpTo ? (
        <AlertAction>
          <Button
            size="xs"
            variant="outline"
            onClick={() => (isStudioPanel(jumpTo) ? openStudioPanel(jumpTo) : setActive(jumpTo))}
          >
            {jumpLabel ?? 'Open'}
            <ArrowRight data-icon="inline-end" />
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  )
}
