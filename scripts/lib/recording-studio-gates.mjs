export function buildRecordingStudioGateSteps({
  includeAppSmoke = true,
  includeDeviceSmoke = false
} = {}) {
  const steps = [
    {
      label: 'desktop recording studio unit tests',
      command: 'pnpm',
      args: [
        '--filter',
        '@videorc/desktop',
        'test',
        'capture.test.ts',
        'session-params.test.ts',
        'studio-health.test.ts',
        'native-preview-present-policy.test.ts'
      ]
    },
    {
      label: 'script artifact analyzer and A/V sync tests',
      command: 'pnpm',
      args: ['test:scripts']
    },
    {
      label: 'backend live layout tests',
      command: 'cargo',
      args: ['test', '-p', 'videorc-backend', 'live_layout::tests::']
    },
    {
      label: 'backend scene layout tests',
      command: 'cargo',
      args: ['test', '-p', 'videorc-backend', 'scene::tests::']
    },
    {
      label: 'backend recording pipeline tests',
      command: 'cargo',
      args: ['test', '-p', 'videorc-backend', 'recording::tests::']
    },
    {
      label: 'backend audio pipeline tests',
      command: 'cargo',
      args: ['test', '-p', 'videorc-backend', 'audio::tests::']
    }
  ]

  if (includeAppSmoke) {
    steps.push({
      label: 'dev app all-layout recording artifact smoke',
      command: 'pnpm',
      args: ['smoke:dev']
    })
  }

  if (includeDeviceSmoke) {
    steps.push({
      label: 'native preview source-complete layout stress recording smoke',
      command: 'pnpm',
      args: ['smoke:recording-native-preview'],
      env: {
        VIDEORC_NATIVE_PREVIEW_SOURCE_COMPLETE_SCENE: '1',
        VIDEORC_NATIVE_PREVIEW_LAYOUT_STRESS_UPDATES: '4'
      }
    })
  }

  return steps
}

export function formatRecordingStudioGatePlan({ steps }) {
  const lines = ['recording-studio-gates: plan']
  for (const [index, step] of steps.entries()) {
    lines.push(`${index + 1}. ${step.label}: ${formatCommand(step)}`)
  }
  return lines.join('\n')
}

function formatCommand(step) {
  const env = step.env
    ? `${Object.keys(step.env)
        .map((name) => `${name}=${step.env[name]}`)
        .join(' ')} `
    : ''
  return `${env}${step.command} ${step.args.join(' ')}`
}
