import { Chain } from '@vultisig/core-chain/Chain'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import { getTwPublicKeyType } from '@vultisig/core-chain/publicKey/tw/getTwPublicKeyType'
import { decodeSigningOutput } from '@vultisig/core-chain/tw/signingOutput'
import { broadcastTx as coreBroadcastTx } from '@vultisig/core-chain/tx/broadcast'
import { getTxHash } from '@vultisig/core-chain/tx/hash'
import { getEncodedSigningInputs } from '@vultisig/core-mpc/keysign/signingInputs'
import { getKeysignTwPublicKey } from '@vultisig/core-mpc/keysign/tw/getKeysignTwPublicKey'
import { compileTx } from '@vultisig/core-mpc/tx/compile/compileTx'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'

import type { WasmProvider } from '../../context/SdkContext'
import type { Signature } from '../../types'
import { convertToKeysignSignatures } from '../utils/convertSignature'
import { VaultError, VaultErrorCode } from '../VaultError'

export type CompiledTxResult = {
  signingOutput: { encoded: string }
  txHash: string
}

/**
 * Handles transaction compilation and broadcasting to blockchain networks.
 */
export class BroadcastService {
  constructor(
    private extractMessageHashes: (keysignPayload: KeysignPayload) => Promise<string[]>,
    private wasmProvider: WasmProvider
  ) {}

  /**
   * Compile signed transactions without broadcasting.
   * Used by the JITO bundle flow to get signed tx bytes before bundling,
   * and internally by broadcastTx.
   */
  async compileTxOnly(params: { chain: Chain; keysignPayload: KeysignPayload; signature: Signature }): Promise<CompiledTxResult[]> {
    const { chain, keysignPayload, signature } = params
    const walletCore = await this.wasmProvider.getWalletCore()
    const messageHashes = await this.extractMessageHashes(keysignPayload)
    const keysignSignatures = convertToKeysignSignatures(signature, messageHashes)
    const publicKeyData = getKeysignTwPublicKey(keysignPayload)
    const publicKeyType = getTwPublicKeyType({ walletCore, chain })
    const coinType = getCoinType({ walletCore, chain })
    const keyType = coinType === walletCore.CoinType.tron
      ? walletCore.PublicKeyType.secp256k1Extended
      : publicKeyType
    const publicKey = walletCore.PublicKey.createWithData(publicKeyData, keyType)

    const txInputsArray = getEncodedSigningInputs({ keysignPayload, walletCore, publicKey })
    if (txInputsArray.length === 0) {
      throw new Error('No transaction inputs found in keysign payload')
    }

    const results: CompiledTxResult[] = []
    for (const txInputData of txInputsArray) {
      const compiled = compileTx({ publicKey, txInputData, signatures: keysignSignatures, chain, walletCore })
      const signingOutput = decodeSigningOutput(chain, compiled)
      const txHash = await getTxHash({ chain, tx: signingOutput })
      results.push({ signingOutput: signingOutput as { encoded: string }, txHash })
    }
    return results
  }

  /**
   * Compile and broadcast a signed transaction to the blockchain network.
   * Returns the hash of the last transaction (the primary one for multi-tx flows).
   */
  async broadcastTx(params: { chain: Chain; keysignPayload: KeysignPayload; signature: Signature }): Promise<string> {
    const { chain } = params

    try {
      const compiledTxs = await this.compileTxOnly(params)

      for (const { signingOutput } of compiledTxs) {
        await coreBroadcastTx({ chain, tx: signingOutput })
      }

      return compiledTxs[compiledTxs.length - 1].txHash
    } catch (error) {
      throw new VaultError(
        VaultErrorCode.BroadcastFailed,
        `Failed to broadcast transaction on ${chain}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error : new Error(String(error))
      )
    }
  }
}
