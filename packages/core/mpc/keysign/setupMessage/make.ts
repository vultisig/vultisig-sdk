import { SignatureAlgorithm } from '@vultisig/core-chain/signing/SignatureAlgorithm'

import { toMpcLibKeyshare } from '../../lib/keyshare'
import { SignSession } from '../../lib/signSession'

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

  return SignSession[signatureAlgorithm].setup(keyId, chainPath, messageBytes, devices)
}
