/**
 * Trust tier a wallet can attach to a discovered or user-added token.
 *
 * - `verified`: listed in a curated registry we trust (our own known-token list
 *   or a chain ecosystem whitelist).
 * - `scam`: positively identified as malicious, typically because it
 *   impersonates a verified token's symbol or name while living at a different
 *   contract address, or because the indexer flagged it.
 * - `unverified`: neither — a real holding we know nothing about.
 */
export const tokenVerifications = ['verified', 'unverified', 'scam'] as const

export type TokenVerification = (typeof tokenVerifications)[number]
