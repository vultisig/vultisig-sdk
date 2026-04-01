import { SignatureAlgorithm } from '@vultisig/core-chain/signing/SignatureAlgorithm'
import { getMpcEngine } from '@vultisig/mpc-types'

import { toMpcLibKeyshare } from './keyshare'

const getEngineKey = (algo: SignatureAlgorithm): 'dkls' | 'schnorr' =>
  algo === 'eddsa' ? 'schnorr' : 'dkls'  // mldsa uses dkls engine

type SignSessionMethods = {
  setup: (
    keyId: Uint8Array,
    chainPath: string,
    messageHash: Uint8Array | null | undefined,
    partyIds: string[]
  ) => Uint8Array
  setupMessageHash: (setupMsg: Uint8Array) => Uint8Array | undefined
}

const dklsMethods: SignSessionMethods = {
  setup: (...args) => getMpcEngine().dkls.signSetup(...args),
  setupMessageHash: (setupMsg) => getMpcEngine().dkls.signSetupMessageHash(setupMsg),
}

export const SignSession: Record<SignatureAlgorithm, SignSessionMethods> = {
  ecdsa: dklsMethods,
  mldsa: dklsMethods,
  eddsa: {
    setup: (keyId, chainPath, messageHash, partyIds) =>
      getMpcEngine().schnorr.signSetup(keyId, chainPath, messageHash as Uint8Array, partyIds),
    setupMessageHash: (setupMsg) =>
      getMpcEngine().schnorr.signSetupMessageHash(setupMsg),
  },
}

type MakeSignSessionInput = {
  setupMessage: Uint8Array
  localPartyId: string
  keyShare: string
  signatureAlgorithm: SignatureAlgorithm
}

export const makeSignSession = async ({
  setupMessage,
  localPartyId,
  keyShare,
  signatureAlgorithm,
}: MakeSignSessionInput) => {
  const engineKey = getEngineKey(signatureAlgorithm)
  return getMpcEngine()[engineKey].createSignSession(
    setupMessage,
    localPartyId,
    toMpcLibKeyshare({
      keyShare,
      signatureAlgorithm,
    })
  )
}
