import { SignatureAlgorithm } from '@vultisig/core-chain/signing/SignatureAlgorithm'
import { Keyshare as DklsKeyshare } from '@vultisig/lib-dkls/vs_wasm'
import { Keyshare as MldsaKeyshare } from '@vultisig/lib-mldsa'
import { Keyshare as SchnorrKeyshare } from '@vultisig/lib-schnorr/vs_schnorr_wasm'

const Keyshare: Record<
  SignatureAlgorithm,
  typeof DklsKeyshare | typeof SchnorrKeyshare | typeof MldsaKeyshare
> = {
  ecdsa: DklsKeyshare,
  eddsa: SchnorrKeyshare,
  mldsa: MldsaKeyshare,
}

type ToMpcLibKeyshareInput = {
  keyShare: string
  signatureAlgorithm: SignatureAlgorithm
}

export const toMpcLibKeyshare = ({
  keyShare,
  signatureAlgorithm,
}: ToMpcLibKeyshareInput) =>
  Keyshare[signatureAlgorithm].fromBytes(Buffer.from(keyShare, 'base64'))
