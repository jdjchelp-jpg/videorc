import { useMemo } from 'react'

import { useStudio } from '@/hooks/use-studio'
import { accountFromSnapshot, type VideorcAccount } from '@/lib/account'
import { VIDEORC_WEB_LINKS, openVideorcWebLink } from '@/lib/videorc-web-links'

export type UseVideorcAccount = {
  account: VideorcAccount
  signIn: () => void
  openAccount: () => void
  signOut: () => void
}

// The single owner of the desktop's Videorc PRODUCT-account state and actions.
// The account comes from the backend (account.get, surfaced by useStudio); it
// stays signed-out until real web auth + token storage populate the snapshot.
// The actions open the web account/login pages; sign out is a no-op until there
// is a session to clear.
export function useVideorcAccount(): UseVideorcAccount {
  const { account: snapshot, signOutAccount } = useStudio()
  const account = useMemo(() => accountFromSnapshot(snapshot), [snapshot])

  return useMemo(
    () => ({
      account,
      signIn: () => openVideorcWebLink(VIDEORC_WEB_LINKS.login),
      openAccount: () => openVideorcWebLink(VIDEORC_WEB_LINKS.account),
      signOut: () => void signOutAccount()
    }),
    [account, signOutAccount]
  )
}
