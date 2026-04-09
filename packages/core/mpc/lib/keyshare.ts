import { SignatureAlgorithm } from '@vultisig/core-chain/signing/SignatureAlgorithm'
import { getMpcEngine } from '@vultisig/mpc-types'

type ToMpcLibKeyshareInput = {
  keyShare: string
  signatureAlgorithm: SignatureAlgorithm
}

export const toMpcLibKeyshare = ({
  keyShare,
  signatureAlgorithm,
}: ToMpcLibKeyshareInput) => {
  if (signatureAlgorithm === 'mldsa') {
    throw new Error(
      'MLDSA uses a dedicated signing path (MldsaKeysign), not the pluggable MPC engine. ' +
      'Route MLDSA keyshares through packages/core/mpc/mldsa/ instead.'
    )
  }
  const engineKey = signatureAlgorithm === 'eddsa' ? 'schnorr' : 'dkls'
  return getMpcEngine()[engineKey].keyshareFromBytes(
    Buffer.from(keyShare, 'base64')
  )
}
