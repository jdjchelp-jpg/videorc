import { describe, expect, it } from 'vitest'

import {
  activeAiWorkflowStatus,
  aiRunButtonLabel,
  latestAiProblemArtifact
} from './ai-workflow-status'
import type { AiArtifact, HealthEvent, SessionSummary } from './backend'

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    aiArtifacts: [],
    healthEvents: [],
    id: 'session-1',
    layout: {},
    mode: 'record',
    sessionLogs: [],
    sources: {},
    startedAt: '2026-07-01T00:00:00.000Z',
    status: 'completed',
    title: 'Session',
    ...overrides
  } as SessionSummary
}

function artifact(overrides: Partial<AiArtifact>): AiArtifact {
  return {
    content: {},
    createdAt: '2026-07-01T00:00:00.000Z',
    id: 'artifact-1',
    kind: 'summary',
    sessionId: 'session-1',
    status: 'ready',
    ...overrides
  }
}

function health(overrides: Partial<HealthEvent>): HealthEvent {
  return {
    code: 'cloud-ai-worker-delayed',
    createdAt: '2026-07-01T00:00:00.000Z',
    id: 'health-1',
    level: 'warn',
    message: 'Queued - worker delayed.',
    sessionId: 'session-1',
    ...overrides
  }
}

describe('ai workflow status', () => {
  it('labels retryable sessions without hiding local extraction', () => {
    expect(
      aiRunButtonLabel({
        aiRunning: false,
        cloudReady: true,
        consent: true,
        hasFailedArtifacts: true,
        hasReviewableArtifacts: false
      })
    ).toBe('Retry AI workflow')
    expect(
      aiRunButtonLabel({
        aiRunning: false,
        cloudReady: false,
        consent: true,
        hasFailedArtifacts: true,
        hasReviewableArtifacts: false
      })
    ).toBe('Extract local audio')
    expect(
      aiRunButtonLabel({
        aiRunning: true,
        cloudReady: true,
        consent: true,
        hasFailedArtifacts: false,
        hasReviewableArtifacts: false
      })
    ).toBe('Running...')
  })

  it('surfaces delayed worker health while the workflow is active', () => {
    const status = activeAiWorkflowStatus(
      session({
        healthEvents: [health({ code: 'cloud-ai-worker-delayed' })]
      })
    )

    expect(status.title).toBe('Queued - worker delayed')
    expect(status.tone).toBe('warning')
  })

  it('falls back to extraction and processing states from local artifacts', () => {
    expect(activeAiWorkflowStatus(session()).title).toBe('Extracting audio')
    expect(
      activeAiWorkflowStatus(
        session({
          aiArtifacts: [artifact({ kind: 'audio-extract' })]
        })
      ).title
    ).toBe('Processing cloud AI')
  })

  it('returns the latest failed or pending artifact for attention banners', () => {
    const pending = artifact({
      kind: 'transcript',
      status: 'pending-consent'
    })
    const failed = artifact({
      content: { message: 'Cloud AI failed.' },
      id: 'artifact-2',
      kind: 'transcript',
      status: 'failed'
    })

    expect(latestAiProblemArtifact(session({ aiArtifacts: [pending, failed] }))).toBe(failed)
  })
})
