import type { AiArtifact, HealthEvent, SessionSummary } from './backend'

export interface AiWorkflowStatus {
  description: string
  title: string
  tone: 'neutral' | 'warning'
}

export function aiRunButtonLabel(params: {
  aiRunning: boolean
  cloudReady: boolean
  consent: boolean
  hasFailedArtifacts: boolean
  hasReviewableArtifacts: boolean
}): string {
  if (params.aiRunning) {
    return 'Running...'
  }
  if (!params.consent || !params.cloudReady) {
    return 'Extract local audio'
  }
  if (params.hasFailedArtifacts || params.hasReviewableArtifacts) {
    return 'Retry AI workflow'
  }
  return 'Run AI workflow'
}

export function activeAiWorkflowStatus(session: SessionSummary): AiWorkflowStatus {
  const latestEvent = latestAiEvent(session.healthEvents)
  if (latestEvent) {
    return statusForHealthEvent(latestEvent)
  }

  const hasAudioExtract = session.aiArtifacts.some(
    (artifact) => artifact.kind === 'audio-extract' && artifact.status === 'ready'
  )
  return hasAudioExtract
    ? {
        description: 'Videorc is waiting for the server job to return generated artifacts.',
        title: 'Processing cloud AI',
        tone: 'neutral'
      }
    : {
        description: 'Videorc is extracting audio locally before any cloud upload.',
        title: 'Extracting audio',
        tone: 'neutral'
      }
}

export function latestAiProblemArtifact(session: SessionSummary): AiArtifact | null {
  return (
    session.aiArtifacts
      .filter((artifact) => artifact.status === 'failed' || artifact.status === 'pending-consent')
      .at(-1) ?? null
  )
}

function latestAiEvent(events: HealthEvent[]): HealthEvent | null {
  return (
    events
      .filter((event) => event.code.startsWith('cloud-ai-') || event.code.startsWith('ai-'))
      .at(-1) ?? null
  )
}

function statusForHealthEvent(event: HealthEvent): AiWorkflowStatus {
  switch (event.code) {
    case 'cloud-ai-worker-delayed':
      return {
        description: event.message,
        title: 'Queued - worker delayed',
        tone: 'warning'
      }
    case 'cloud-ai-worker-still-processing':
      return {
        description: event.message,
        title: 'Still processing',
        tone: 'warning'
      }
    case 'cloud-ai-job-failed':
    case 'cloud-ai-sign-in-required':
      return {
        description: event.message,
        title: 'Cloud AI needs attention',
        tone: 'warning'
      }
    default:
      return {
        description: event.message,
        title: 'AI workflow running',
        tone: 'neutral'
      }
  }
}
