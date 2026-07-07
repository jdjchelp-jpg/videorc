import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildWindowsLocalGateSteps,
  evaluateWindowsLocalGateHost,
  formatWindowsLocalGatePlan
} from './windows-local-gates.mjs'

describe('evaluateWindowsLocalGateHost', () => {
  it('accepts Windows 11 x64 hosts', () => {
    const result = evaluateWindowsLocalGateHost({
      platform: 'win32',
      arch: 'x64',
      release: '10.0.22631'
    })

    assert.equal(result.ok, true)
    assert.deepEqual(result.failures, [])
  })

  it('blocks non-Windows and old Windows hosts explicitly', () => {
    assert.match(
      evaluateWindowsLocalGateHost({ platform: 'darwin', arch: 'arm64' }).failures.join('\n'),
      /requires Windows 11 x64/
    )
    assert.match(
      evaluateWindowsLocalGateHost({
        platform: 'win32',
        arch: 'x64',
        release: '10.0.19045'
      }).failures.join('\n'),
      /requires Windows 11 build 22000/
    )
  })
})

describe('buildWindowsLocalGateSteps', () => {
  it('includes package preflight, package build, and packaged recording smoke', () => {
    const steps = buildWindowsLocalGateSteps({ repoRoot: 'C:/repo' })
    const labels = steps.map((step) => step.label)

    assert.deepEqual(labels, [
      'desktop unit tests',
      'backend capture-input seam tests',
      'backend FIFO seam tests',
      'build release backend',
      'fetch pinned Windows FFmpeg',
      'Windows package preflight',
      'package desktop Windows dir',
      'packaged boot plus test-pattern recording smoke'
    ])
    assert.deepEqual(steps.at(-1).args, ['smoke:packaged:bundled'])
    assert.match(
      steps.at(-1).env.VIDEORC_PACKAGED_APP_EXECUTABLE,
      /C:\/repo\/apps\/desktop\/release\/win-unpacked\/Videorc\.exe$/
    )
    assert.match(
      steps.at(-1).env.VIDEORC_SMOKE_OUTPUT_DIR,
      /C:\/repo\/docs\/acceptance\/artifacts\/windows\/\d{4}-\d{2}-\d{2}$/
    )
  })

  it('allows the Windows acceptance artifact directory to be pinned', () => {
    const steps = buildWindowsLocalGateSteps({
      acceptanceDir: 'docs/acceptance/artifacts/windows/2026-07-08-lab-1',
      repoRoot: 'C:/repo'
    })

    assert.match(
      steps.at(-1).env.VIDEORC_SMOKE_OUTPUT_DIR,
      /C:\/repo\/docs\/acceptance\/artifacts\/windows\/2026-07-08-lab-1$/
    )
  })

  it('formats host blockers and commands for dry-run evidence', () => {
    const report = formatWindowsLocalGatePlan({
      host: evaluateWindowsLocalGateHost({ platform: 'darwin', arch: 'arm64' }),
      steps: buildWindowsLocalGateSteps({ repoRoot: '/repo' })
    })

    assert.match(report, /windows-local-gates: plan/)
    assert.match(report, /evidence output:/)
    assert.match(report, /windows-app-acceptance-template\.md/)
    assert.match(report, /\[blocked\] host: requires Windows 11 x64/)
    assert.match(report, /package:preflight:windows/)
    assert.match(report, /smoke:packaged:bundled/)
  })
})
