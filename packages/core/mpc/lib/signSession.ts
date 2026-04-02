import { SignatureAlgorithm } from '@vultisig/core-chain/signing/SignatureAlgorithm'
import { getMpcEngine } from '@vultisig/mpc-types'

import { toMpcLibKeyshare } from './keyshare'

const getEngineKey = (algo: SignatureAlgorithm): 'dkls' | 'schnorr' => {
  if (algo === 'mldsa') {
    throw new Error(
      'MLDSA uses a dedicated signing path (MldsaKeysign), not the pluggable MPC engine. ' +
      'Route MLDSA signing through packages/core/mpc/mldsa/ instead.'
    )
  }
  return algo === 'eddsa' ? 'schnorr' : 'dkls'
}

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

const mldsaNotSupported: SignSessionMethods = {
  setup: () => {
    throw new Error(
      'MLDSA uses a dedicated signing path (MldsaKeysign), not the pluggable MPC engine.'
    )
  },
  setupMessageHash: () => {
    throw new Error(
      'MLDSA uses a dedicated signing path (MldsaKeysign), not the pluggable MPC engine.'
    )
  },
}

export const SignSession: Record<SignatureAlgorithm, SignSessionMethods> = {
  ecdsa: dklsMethods,
  mldsa: mldsaNotSupported,
  eddsa: {
    setup: (keyId, chainPath, messageHash, partyIds) => {
      if (!messageHash) {
        throw new Error('EdDSA signing requires a message hash')
      }
      return getMpcEngine().schnorr.signSetup(keyId, chainPath, messageHash, partyIds)
    },
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
