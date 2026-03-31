import { SignatureAlgorithm } from '@vultisig/core-chain/signing/SignatureAlgorithm'
import { SignSession as DklsSignSession } from '@vultisig/lib-dkls/vs_wasm'
import { SignSession as MldsaSignSession } from '@vultisig/lib-mldsa'
import { SignSession as SchnorrSignSession } from '@vultisig/lib-schnorr/vs_schnorr_wasm'

import { toMpcLibKeyshare } from './keyshare'

export const SignSession: Record<
  SignatureAlgorithm,
  typeof DklsSignSession | typeof SchnorrSignSession | typeof MldsaSignSession
> = {
  ecdsa: DklsSignSession,
  eddsa: SchnorrSignSession,
  mldsa: MldsaSignSession,
}

type MakeSignSessionInput = {
  setupMessage: Uint8Array
  localPartyId: string
  keyShare: string
  signatureAlgorithm: SignatureAlgorithm
}

export const makeSignSession = ({
  setupMessage,
  localPartyId,
  keyShare,
  signatureAlgorithm,
}: MakeSignSessionInput) => {
  const ks = toMpcLibKeyshare({ keyShare, signatureAlgorithm })
  const Session = SignSession[signatureAlgorithm]
  return new Session(setupMessage, localPartyId, ks as never)
}
