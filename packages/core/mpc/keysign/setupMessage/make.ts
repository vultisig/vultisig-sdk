import { SignatureAlgorithm } from '@vultisig/core-chain/signing/SignatureAlgorithm'
import { SignSession as DklsSignSession } from '@vultisig/lib-dkls/vs_wasm'
import { SignSession as MldsaSignSession } from '@vultisig/lib-mldsa'
import { SignSession as SchnorrSignSession } from '@vultisig/lib-schnorr/vs_schnorr_wasm'

import { toMpcLibKeyshare } from '../../lib/keyshare'

const mldsaSignLevel = 44

type MakeSetupMessageInput = {
  keyShare: string
  chainPath: string
  message: string
  devices: string[]
  signatureAlgorithm: SignatureAlgorithm
}

export const makeSetupMessage = ({
  keyShare,
  chainPath,
  message,
  devices,
  signatureAlgorithm,
}: MakeSetupMessageInput) => {
  const ks = toMpcLibKeyshare({ keyShare, signatureAlgorithm })
  const keyId = ks.keyId()
  const messageBytes = Buffer.from(message, 'hex')

  if (signatureAlgorithm === 'mldsa') {
    return MldsaSignSession.setup(
      mldsaSignLevel,
      keyId,
      chainPath,
      messageBytes,
      devices
    )
  }

  if (signatureAlgorithm === 'ecdsa') {
    return DklsSignSession.setup(keyId, chainPath, messageBytes, devices)
  }

  return SchnorrSignSession.setup(keyId, chainPath, messageBytes, devices)
}
