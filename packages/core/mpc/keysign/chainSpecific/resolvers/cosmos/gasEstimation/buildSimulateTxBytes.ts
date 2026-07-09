import { Buffer } from 'buffer'
import { CosmosChain } from '@vultisig/core-chain/Chain'
import { cosmosFeeCoinDenom } from '@vultisig/core-chain/chains/cosmos/cosmosFeeCoinDenom'
import { getCosmosGasLimit } from '@vultisig/core-chain/chains/cosmos/cosmosGasLimitRecord'
import { getTwChainId } from '@vultisig/core-chain/chains/evm/tx/tw/getTwChainId'
import { assertErrorMessage } from '@vultisig/lib-utils/error/assertErrorMessage'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import { parseCosmosSerialized } from '@vultisig/core-chain/chains/cosmos/utils/parseCosmosSerialized'
import { TW, WalletCore } from '@trustwallet/wallet-core'
import Long from 'long'

type BuildSimulateTxBytesInput = {
  walletCore: WalletCore
  chain: CosmosChain
  hexPublicKey: string
  fromAddress: string
  toAddress: string
  /** send amount in base units (matches the real send so simulated gas lines up) */
  amount: string
  denom: string
  memo?: string
  accountNumber: bigint
  sequence: bigint
}

/**
 * Builds the base64 `tx_bytes` (protobuf `TxRaw`) for a native bank send,
 * carrying a 64-byte dummy signature. `/cosmos/tx/v1beta1/simulate` decodes
 * this and runs it against current state while skipping signature
 * verification, so the bogus signature is accepted. Models only a native
 * `MsgSend` — callers must restrict simulation to native sends.
 *
 * Mirrors iOS `CosmosGasEstimator.buildSimulateTxBytes`.
 */
export const buildSimulateTxBytes = ({
  walletCore,
  chain,
  hexPublicKey,
  fromAddress,
  toAddress,
  amount,
  denom,
  memo,
  accountNumber,
  sequence,
}: BuildSimulateTxBytesInput): string => {
  const coinType = getCoinType({ walletCore, chain })
  const publicKeyData = new Uint8Array(Buffer.from(hexPublicKey, 'hex'))

  const input = TW.Cosmos.Proto.SigningInput.create({
    publicKey: publicKeyData,
    signingMode: TW.Cosmos.Proto.SigningMode.Protobuf,
    chainId: getTwChainId({ walletCore, chain }),
    accountNumber: Long.fromString(accountNumber.toString()),
    sequence: Long.fromString(sequence.toString()),
    mode: TW.Cosmos.Proto.BroadcastMode.SYNC,
    // A non-empty memo grows the tx body, which the node charges gas for.
    // Include it so the simulated gas matches the real send.
    ...(memo ? { memo } : {}),
    // Simulate ignores the fee, but the tx must still be well-formed.
    fee: TW.Cosmos.Proto.Fee.create({
      gas: Long.fromBigInt(getCosmosGasLimit({ chain })),
      amounts: [TW.Cosmos.Proto.Amount.create({ denom: cosmosFeeCoinDenom[chain], amount: '1' })],
    }),
    messages: [
      TW.Cosmos.Proto.Message.create({
        sendCoinsMessage: TW.Cosmos.Proto.Message.Send.create({
          fromAddress,
          toAddress,
          amounts: [TW.Cosmos.Proto.Amount.create({ denom, amount })],
        }),
      }),
    ],
  })

  const inputData = TW.Cosmos.Proto.SigningInput.encode(input).finish()

  const preOutput = TW.TxCompiler.Proto.PreSigningOutput.decode(
    walletCore.TransactionCompiler.preImageHashes(coinType, inputData)
  )
  assertErrorMessage(preOutput.errorMessage)

  // The node skips sig verification in simulate mode, so a fixed 64-byte dummy
  // compact signature is enough to assemble a decodable TxRaw.
  const signatures = walletCore.DataVector.create()
  signatures.add(new Uint8Array(64).fill(1))
  const publicKeys = walletCore.DataVector.create()
  publicKeys.add(publicKeyData)

  const compiled = walletCore.TransactionCompiler.compileWithSignatures(coinType, inputData, signatures, publicKeys)
  const output = TW.Cosmos.Proto.SigningOutput.decode(compiled)

  // WalletCore may set a non-fatal errorMessage for the dummy signature while
  // still emitting usable tx_bytes (the real signing path tolerates this too),
  // so treat a missing/empty tx_bytes — surfaced by the parser — as the real
  // failure signal rather than errorMessage.
  return parseCosmosSerialized(output.serialized).tx_bytes
}
