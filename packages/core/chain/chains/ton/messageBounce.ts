import { Address } from '@ton/core'
import { attempt } from '@vultisig/lib-utils/attempt'

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
 * Only the canonical raw spelling counts as a raw address: `Address.parseRaw` is lenient
 * (`parseInt` on the workchain, any hex case), so anything that does not round-trip to
 * `workchain:hex` is treated like other unparseable input and reported non-bounceable;
 * the signer rejects such a destination on its own. The flag is part of the signed body,
 * so every co-signer has to derive it from the same place: the message's own address plus
 * whether the message carries `stateInit`, never a wallet-level default.
 */
export const getTonMessageBounceable = (address: string, hasStateInit = false): boolean => {
  if (!Address.isFriendly(address)) {
    const parsedRaw = attempt(() => Address.parseRaw(address))
    if ('error' in parsedRaw || parsedRaw.data.toRawString() !== address.toLowerCase()) {
      return false
    }

    return !hasStateInit
  }

  const parsed = attempt(() => Address.parseFriendly(address))
  if ('error' in parsed) {
    return false
  }

  return parsed.data.isBounceable
}
