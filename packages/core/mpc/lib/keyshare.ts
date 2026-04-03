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
      'MLDSA uses a dedicated signing path (MldsaKeysign) with its own keyshare format. ' +
      'Do not route MLDSA keyshares through the pluggable MPC engine.'
    )
  }
  const engineKey = signatureAlgorithm === 'eddsa' ? 'schnorr' : 'dkls'
  return getMpcEngine()[engineKey].keyshareFromBytes(
    Buffer.from(keyShare, 'base64')
  )
}
