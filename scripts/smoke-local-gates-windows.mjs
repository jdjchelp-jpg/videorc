import { spawn } from 'node:child_process'
import { release } from 'node:os'
import { resolve } from 'node:path'

import {
  buildWindowsLocalGateSteps,
  evaluateWindowsLocalGateHost,
  formatWindowsLocalGatePlan
} from './lib/windows-local-gates.mjs'

const repoRoot = resolve(import.meta.dirname, '..')
const dryRun = process.argv.includes('--dry-run') || process.argv.includes('--print-only')
const host = evaluateWindowsLocalGateHost({ release: release() })
const steps = buildWindowsLocalGateSteps({
  repoRoot,
  acceptanceDir: process.env.VIDEORC_WINDOWS_ACCEPTANCE_DIR
})

console.log(formatWindowsLocalGatePlan({ host, steps }))

if (dryRun) {
  process.exit(0)
}

if (!host.ok) {
  process.exit(1)
}

for (const step of steps) {
  await runStep(step)
}

console.log('windows-local-gates: PASS')

function runStep(step) {
  return new Promise((resolveStep, rejectStep) => {
    console.log(`\n[windows-local-gates] ${step.label}`)
    const child = spawn(step.command, step.args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...step.env
      },
      shell: process.platform === 'win32',
      stdio: 'inherit'
    })

    child.on('error', rejectStep)
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolveStep()
        return
      }
      rejectStep(
        new Error(
          `${step.label} failed: ${step.command} ${step.args.join(' ')} exited with code=${code} signal=${signal}`
        )
      )
    })
  })
}
