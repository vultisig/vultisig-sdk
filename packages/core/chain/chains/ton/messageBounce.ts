import { Address } from '@ton/core'
import { attempt } from '@vultisig/lib-utils/attempt'

/**
 * A raw `workchain:hash` destination in any spelling the signer accepts. Leading zeros,
 * an explicit sign and a `0x`-prefixed hash all name the same account: `0:…`, `00:…`,
 * `+0:…` and `-0:…` compile to one and the same pre-image, as do `-1:…` and `-01:…`.
 *
 * Matching the shape beats demanding one canonical spelling. The error that costs money
 * is calling a deployed contract non-bounceable, so every destination WalletCore will
 * sign has to reach the `!hasStateInit` rule below — `00:<hash>` used to fall through it
 * and get signed non-bounceable while `0:<hash>` did not, losing the refund on a
 * rejection purely because of how the dApp spelled the address. Being wider here than
 * the signer costs nothing: a shape WalletCore refuses never reaches a signed message.
 */
const rawAddressPattern = /^[+-]?\d+:(?:0x)?[0-9a-fA-F]{64}$/

/**
 * The bounce flag a dApp (TonConnect) message destination declares. A user-friendly
 * address carries it in its tag byte — `EQ…`/`kQ…` bounceable, `UQ…`/`0Q…` not. Raw
 * `workchain:hex` addresses carry no tag, so callers have to disambiguate the two cases
 * the raw form can mean:
 * - a deployment message with `stateInit`, whose destination has no code yet to bounce
 *   from and therefore must stay non-bounceable
 * - an already-deployed contract/router address, which must default bounceable so a
 *   rejection refunds instead of absorbing the transfer
 *
 * Input that is neither shape is reported non-bounceable, and the signer refuses such a
 * destination anyway. The flag is part of the signed body, so every co-signer has to
 * derive it from the same place: the message's own address plus whether the message
 * carries `stateInit`, never a wallet-level default.
 */
export const getTonMessageBounceable = (address: string, hasStateInit = false): boolean => {
  if (!Address.isFriendly(address)) {
    return rawAddressPattern.test(address) && !hasStateInit
  }

  const parsed = attempt(() => Address.parseFriendly(address))
  if ('error' in parsed) {
    return false
  }

  return parsed.data.isBounceable
}
