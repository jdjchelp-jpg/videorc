import type { GoLivePreflight } from './backend'

// Owned by the central web-links module now; re-exported here so existing
// `import { VIDEORC_PREMIUM_URL } from '@/lib/premium-upgrade'` callers keep working.
export { VIDEORC_PREMIUM_URL } from './videorc-web-links'

const PREMIUM_MESSAGE_RE = /\b(?:Videorc\s+)?Premium\b/i

export function isPremiumUpgradeMessage(message: string | null | undefined): boolean {
  return PREMIUM_MESSAGE_RE.test(message ?? '')
}

export function premiumRequiredIssueMessage(
  preflight: Pick<GoLivePreflight, 'issues'>
): string | null {
  return (
    preflight.issues.find(
      (issue) => issue.severity === 'error' && isPremiumUpgradeMessage(issue.message)
    )?.message ?? null
  )
}
