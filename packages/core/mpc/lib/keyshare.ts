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
  const engineKey = signatureAlgorithm === 'eddsa' ? 'schnorr' : 'dkls'
  return getMpcEngine()[engineKey].keyshareFromBytes(
    Buffer.from(keyShare, 'base64')
  )
}
