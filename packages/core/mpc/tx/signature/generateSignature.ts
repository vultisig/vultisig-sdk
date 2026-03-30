import { SignatureFormat } from '@vultisig/core-chain/signing/SignatureFormat'
import { without } from '@vultisig/lib-utils/array/without'
import { match } from '@vultisig/lib-utils/match'
import { pick } from '@vultisig/lib-utils/record/pick'
import { recordMap } from '@vultisig/lib-utils/record/recordMap'
import { WalletCore } from '@trustwallet/wallet-core'

import { KeysignSignature } from '../../keysign/KeysignSignature'

type Input = {
  walletCore: WalletCore
  signature: KeysignSignature
  signatureFormat: SignatureFormat
}

export const generateSignature = ({
  walletCore,
  signature,
  signatureFormat,
}: Input) => {
  return match(signatureFormat, {
    rawWithRecoveryId: () => {
      const [r, s, recovery_id] = without(
        [signature.r, signature.s, signature.recovery_id],
        undefined
      ).map(value => walletCore.HexCoding.decode(value))

      return new Uint8Array([...r, ...s, ...recovery_id])
    },
    raw: () => {
      const { r, s } = recordMap(pick(signature, ['r', 's']), value =>
        walletCore.HexCoding.decode(value).reverse()
      )

      return new Uint8Array([...r, ...s])
    },
    der: () => {
      return walletCore.HexCoding.decode(signature.der_signature)
    },
  })
}
