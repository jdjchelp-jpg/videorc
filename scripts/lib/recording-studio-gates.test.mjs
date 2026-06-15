import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildRecordingStudioGateSteps,
  formatRecordingStudioGatePlan
} from './recording-studio-gates.mjs'

describe('buildRecordingStudioGateSteps', () => {
  it('covers studio unit tests, script A/V tests, backend studio modules, and app smoke', () => {
    const steps = buildRecordingStudioGateSteps()
    const labels = steps.map((step) => step.label)

    assert.deepEqual(labels, [
      'desktop recording studio unit tests',
      'script artifact analyzer and A/V sync tests',
      'backend live layout tests',
      'backend scene layout tests',
      'backend recording pipeline tests',
      'backend audio pipeline tests',
      'dev app all-layout recording artifact smoke'
    ])
    assert.deepEqual(steps[0].args, [
      '--filter',
      '@videorc/desktop',
      'test',
      'capture.test.ts',
      'session-params.test.ts',
      'studio-health.test.ts',
      'native-preview-present-policy.test.ts'
    ])
    assert.deepEqual(steps[1].args, ['test:scripts'])
    assert.deepEqual(steps.at(-1).args, ['smoke:dev'])
  })

  it('can include the heavier native preview layout-stress smoke', () => {
    const steps = buildRecordingStudioGateSteps({ includeDeviceSmoke: true })
    const deviceSmoke = steps.at(-1)

    assert.equal(deviceSmoke.label, 'native preview source-complete layout stress recording smoke')
    assert.deepEqual(deviceSmoke.args, ['smoke:recording-native-preview'])
    assert.equal(deviceSmoke.env.VIDEORC_NATIVE_PREVIEW_SOURCE_COMPLETE_SCENE, '1')
    assert.equal(deviceSmoke.env.VIDEORC_NATIVE_PREVIEW_LAYOUT_STRESS_UPDATES, '4')
  })

  it('formats commands for dry-run evidence', () => {
    const report = formatRecordingStudioGatePlan({
      steps: buildRecordingStudioGateSteps({ includeDeviceSmoke: true })
    })

    assert.match(report, /recording-studio-gates: plan/)
    assert.match(report, /capture\.test\.ts/)
    assert.match(report, /test:scripts/)
    assert.match(report, /live_layout::tests::/)
    assert.match(report, /smoke:dev/)
    assert.match(report, /VIDEORC_NATIVE_PREVIEW_SOURCE_COMPLETE_SCENE=1/)
    assert.match(report, /VIDEORC_NATIVE_PREVIEW_LAYOUT_STRESS_UPDATES=4/)
    assert.match(report, /pnpm smoke:recording-native-preview/)
  })
})
