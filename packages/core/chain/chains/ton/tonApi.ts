/**
 * Public TonAPI base URL. Used for the surfaces the Vultisig `/ton` proxy
 * (a toncenter pass-through) does not cover: staking pools, emulation and the
 * gasless relay. Unauthenticated requests are rate-limited, so callers should
 * hit it only at user-driven moments rather than in polling loops.
 */
export const tonApiPublicUrl = 'https://tonapi.io'
