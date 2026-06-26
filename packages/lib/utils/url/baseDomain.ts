import { getDomain } from 'tldts'

/**
 * Resolve the registrable (eTLD+1) domain used to key dApp connection sessions.
 *
 * Uses the Public Suffix List (including its private section, via
 * `allowPrivateDomains`) so multi-label public suffixes are handled correctly:
 * `good.vercel.app` and `attacker.vercel.app` resolve to distinct keys rather
 * than collapsing to the shared suffix `vercel.app`. Falls back to the bare
 * hostname for inputs without a registrable domain (e.g. `localhost`, IPs).
 */
export const getUrlBaseDomain = (url: string): string => {
  const { hostname } = new URL(url)
  return getDomain(hostname, { allowPrivateDomains: true }) ?? hostname
}
