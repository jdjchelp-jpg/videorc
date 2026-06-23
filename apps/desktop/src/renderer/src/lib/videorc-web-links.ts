// Single source of truth for Videorc product web URLs (account, login, premium,
// billing). Don't scatter https://videorc.com/... across components — import from
// here so the origin and paths live in exactly one place (Account Dropdown plan).

const VIDEORC_WEB_ORIGIN = 'https://videorc.com'

export const VIDEORC_WEB_LINKS = {
  account: `${VIDEORC_WEB_ORIGIN}/account`,
  login: `${VIDEORC_WEB_ORIGIN}/login`,
  premium: `${VIDEORC_WEB_ORIGIN}/premium`,
  billing: `${VIDEORC_WEB_ORIGIN}/account/billing`
} as const

export type VideorcWebLink = keyof typeof VIDEORC_WEB_LINKS

// Re-exported by premium-upgrade.ts so existing
// `import { VIDEORC_PREMIUM_URL } from '@/lib/premium-upgrade'` callers keep working.
export const VIDEORC_PREMIUM_URL = VIDEORC_WEB_LINKS.premium

// Open a Videorc web link in the user's browser. Uses the main-process opener
// (the same path premium/OAuth links already use); falls back to window.open
// outside Electron.
export function openVideorcWebLink(url: string): void {
  const opener = window.videorc?.openOAuthUrl
  if (opener) {
    void opener(url)
    return
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}
