import { describe, expect, it } from 'vitest'

import { studioHealth, type StudioHealthInput } from './studio-health'

function stats(overrides: Partial<StudioHealthInput> = {}): StudioHealthInput {
  return {
    compositorBackend: 'metal',
    compositorCpuFallbackFrames: 0,
    previewTransport: 'native-surface',
    ...overrides
  }
}

describe('studioHealth', () => {
  it('reports Live on a healthy Metal session while active', () => {
    expect(studioHealth(stats(), true)).toMatchObject({ tone: 'good', value: 'Live' })
  })

  it('reports Ready on a healthy Metal session while idle', () => {
    expect(studioHealth(stats(), false)).toMatchObject({ tone: 'good', value: 'Ready' })
  })

  it('degrades to "Preview may not match recording" on CPU fallback', () => {
    const result = studioHealth(stats({ compositorBackend: 'cpu-fallback' }), false)
    expect(result.tone).toBe('error')
    expect(result.value).toBe('Degraded')
    expect(result.detail).toContain('Preview may not match recording')
  })

  it('includes the fallback reason in the degraded detail when known', () => {
    const result = studioHealth(
      stats({ compositorBackend: 'cpu-fallback', compositorFallbackReason: 'Metal disabled' }),
      true
    )
    expect(result.detail).toBe('Preview may not match recording — Metal disabled')
  })

  it('degrades when CPU fallback frames appear mid-recording even if the backend label is metal', () => {
    expect(studioHealth(stats({ compositorCpuFallbackFrames: 5 }), true).tone).toBe('error')
  })

  it('does not degrade on stale CPU fallback frames while idle', () => {
    expect(studioHealth(stats({ compositorCpuFallbackFrames: 5 }), false)).toMatchObject({
      tone: 'good',
      value: 'Ready'
    })
  })

  it('warns when preview present latency exceeds the live budget', () => {
    expect(studioHealth(stats({ previewInputToPresentLatencyP95Ms: 120 }), true)).toMatchObject({
      tone: 'warn',
      value: 'Lagging'
    })
  })

  it('warns when preview is on an image-polling fallback transport', () => {
    expect(studioHealth(stats({ previewTransport: 'latest-jpeg-polling' }), true)).toMatchObject({
      tone: 'warn',
      value: 'Fallback'
    })
  })

  it('is neutral when no compositor has reported yet', () => {
    expect(studioHealth(stats({ compositorBackend: undefined }), false)).toMatchObject({
      tone: 'neutral',
      value: 'Idle'
    })
  })
})
