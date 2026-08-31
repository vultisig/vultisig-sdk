import { Address } from '@ton/core'
import { attempt } from '@vultisig/lib-utils/attempt'

/**
 * The bounce flag a dApp (TonConnect) message destination declares. A user-friendly
 * address carries it in its tag byte — `EQ…`/`kQ…` bounceable, `UQ…`/`0Q…` not — while a
 * raw `workchain:hex` address carries no tag and is treated as non-bounceable: that is
 * the usual shape of a deployment message, whose destination has no code yet to bounce
 * from. Unparseable input is non-bounceable here too; the signer rejects such a
 * destination on its own. The flag is part of the signed body, so every co-signer has to
 * derive it from the same place: the message's own address, never a wallet-level default.
 */
export const getTonMessageBounceable = (address: string): boolean => {
  if (!Address.isFriendly(address)) {
    return false
  }

  const parsed = attempt(() => Address.parseFriendly(address))
  if ('error' in parsed) {
    return false
  }

  return parsed.data.isBounceable
}
