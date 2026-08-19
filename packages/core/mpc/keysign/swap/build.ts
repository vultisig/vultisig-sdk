import { Buffer } from 'buffer'
import { create } from '@bufbuild/protobuf'
import { buildSignBitcoinFromPsbt } from '@vultisig/core-chain/chains/utxo/tx/buildSignBitcoinFromPsbt'
import { fromChainAmountDisplay } from '@vultisig/core-chain/amount/fromChainAmountExact'
import { toChainAmount } from '@vultisig/core-chain/amount/toChainAmount'
import { Chain } from '@vultisig/core-chain/Chain'
import { isChainOfKind } from '@vultisig/core-chain/ChainKind'
import { getErc20Allowance } from '@vultisig/core-chain/chains/evm/erc20/getErc20Allowance'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { areEqualCoins } from '@vultisig/core-chain/coin/Coin'
import { COW_VAULT_RELAYER_ADDRESS } from '@vultisig/core-chain/swap/general/cowswap/config'
import { encodeCowSwapKeysignData } from '@vultisig/core-chain/swap/general/cowswap/keysign/cowSwapKeysignData'
import { GeneralSwapTx } from '@vultisig/core-chain/swap/general/GeneralSwapQuote'
import { getSwapDestinationAddress } from '@vultisig/core-chain/swap/keysign/getSwapDestinationAddress'
import { nativeSwapQuoteToSwapPayload } from '@vultisig/core-mpc/swap/native/utils/nativeSwapQuoteToSwapPayload'
import { SwapQuote, SwapQuoteResult } from '@vultisig/core-chain/swap/quote/SwapQuote'
import { getChainSpecific } from '@vultisig/core-mpc/keysign/chainSpecific'
import { getBlockchainSpecificValue } from '@vultisig/core-mpc/keysign/chainSpecific/KeysignChainSpecific'
import { refineKeysignUtxo } from '@vultisig/core-mpc/keysign/refine/utxo'
import { CommKeysignSwapPayload } from '@vultisig/core-mpc/keysign/swap/KeysignSwapPayload'
import { getKeysignUtxoInfo } from '@vultisig/core-mpc/keysign/utxo/getKeysignUtxoInfo'
import { KeysignLibType } from '@vultisig/core-mpc/mpcLib'
import { verifySwapKitBitcoinPsbtOutputs } from '@vultisig/core-mpc/tx/swapkitSignBitcoin'
import { toCommCoin } from '@vultisig/core-mpc/types/utils/commCoin'
import {
  OneInchQuoteSchema,
  OneInchSwapPayloadSchema,
  OneInchTransaction,
  OneInchTransactionSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/1inch_swap_payload_pb'
import { Erc20ApprovePayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/erc20_approve_payload_pb'
import { KeysignPayload, KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { SwapKitSwapPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/swapkit_swap_payload_pb'
import { TransactionType } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import {
  SignSuiSchema,
  WasmExecuteContractPayloadSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'
import { matchRecordUnion } from '@vultisig/lib-utils/matchRecordUnion'
import { WalletCore } from '@trustwallet/wallet-core'
import { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'
import { Psbt } from 'bitcoinjs-lib'

export type BuildSwapKeysignPayloadInput = {
  fromCoin: AccountCoin
  toCoin: AccountCoin
  amount: string | number
  swapQuote: SwapQuote
  vaultId: string
  localPartyId: string
  fromPublicKey: PublicKey
  toPublicKey: PublicKey
  libType: KeysignLibType
  walletCore: WalletCore
  /**
   * Optional explicit gas limit (units) for EVM swaps. When set it replaces the
   * aggregator's estimate on `ethereumSpecific.gasLimit`; the gas price is still
   * computed normally. Ignored for non-EVM chains and when omitted.
   */
  gasLimitOverride?: bigint
}

type TransferSwapTx = Extract<GeneralSwapTx, { transfer: unknown }>['transfer']
type CosmosWasmSwapTx = Extract<GeneralSwapTx, { cosmosWasm: unknown }>['cosmosWasm']

const getRujiTradeFundAmount = (tx: CosmosWasmSwapTx, fromCoin: AccountCoin): bigint => {
  const expectedDenom =
    fromCoin.chain === Chain.THORChain && fromCoin.id === undefined && fromCoin.ticker.toUpperCase() === 'RUNE'
      ? 'rune'
      : fromCoin.chain === Chain.THORChain && fromCoin.id?.toLowerCase() === 'x/brune'
        ? 'x/brune'
        : undefined

  if (!expectedDenom) {
    throw new Error('RUJI Trade CosmWasm swaps require a THORChain RUNE or bRUNE source coin.')
  }
  if (tx.sender !== fromCoin.address) {
    throw new Error('RUJI Trade CosmWasm sender does not match the source account.')
  }
  if (!tx.contract.trim() || !tx.executeMsg.trim()) {
    throw new Error('RUJI Trade CosmWasm route is missing its contract or execute message.')
  }
  if (tx.funds.length !== 1 || tx.funds[0].denom.toLowerCase() !== expectedDenom) {
    throw new Error(`RUJI Trade CosmWasm route must attach exactly one ${expectedDenom} fund.`)
  }
  if (!/^\d+$/.test(tx.funds[0].amount) || BigInt(tx.funds[0].amount) <= 0n) {
    throw new Error('RUJI Trade CosmWasm route contains an invalid fund amount.')
  }

  let executeMsg: unknown
  try {
    executeMsg = JSON.parse(tx.executeMsg)
  } catch {
    throw new Error('RUJI Trade CosmWasm route contains an invalid execute message.')
  }
  const min = (executeMsg as { swap?: { min?: { min_return?: unknown; to?: unknown } } })?.swap?.min
  if (
    typeof min?.min_return !== 'string' ||
    !/^\d+$/.test(min.min_return) ||
    BigInt(min.min_return) <= 0n ||
    typeof min.to !== 'string' ||
    !min.to.trim()
  ) {
    throw new Error('RUJI Trade CosmWasm route must contain a guarded FIN swap execute message.')
  }

  return BigInt(tx.funds[0].amount)
}

const isSwapKitBitcoinPsbt = (fromCoin: AccountCoin, transfer: TransferSwapTx) =>
  fromCoin.chain === Chain.Bitcoin && transfer.txType?.toUpperCase() === 'PSBT'

const getSwapKitBitcoinSignData = (fromCoin: AccountCoin, transfer: TransferSwapTx): KeysignPayload['signData'] => {
  if (!isSwapKitBitcoinPsbt(fromCoin, transfer)) {
    throw new Error('SwapKit Bitcoin transfer routes must include PSBT txType and txPayload.')
  }

  if (!transfer.txPayload?.length) {
    throw new Error('SwapKit Bitcoin PSBT payload is empty.')
  }

  const signBitcoin = buildSignBitcoinFromPsbt({
    psbt: Psbt.fromBuffer(Buffer.from(transfer.txPayload)),
    senderAddress: fromCoin.address,
  })

  verifySwapKitBitcoinPsbtOutputs({
    signBitcoin,
    senderAddress: fromCoin.address,
    expectedToAddress: transfer.to,
    expectedToAmount: transfer.amount,
  })

  return {
    case: 'signBitcoin',
    value: signBitcoin,
  }
}

/**
 * Stage SwapKit's pre-built Sui programmable transaction block for signing.
 *
 * The PTB already encodes coins, gas and recipients, so it is forwarded to the
 * existing `signSui` path (WalletCore `SignDirect`) verbatim rather than being
 * reconstructed as a Pay / PaySui input. Re-encoding to base64 here is
 * deliberate: `SwapKitSwapPayload.txPayload` stays raw bytes so a cosigning iOS
 * or Android peer rebuilds byte-identical signing input, while `SignSui`'s wire
 * contract is a base64 string.
 */
const getSwapKitSuiSignData = (transfer: TransferSwapTx): KeysignPayload['signData'] => {
  // Deliberately NOT gated on `txType`: SwapKit renames base64 tx types on the
  // wire without versioning (see `buildTransferTx`), so the source chain — which
  // the caller has already matched on — is the only reliable discriminator.
  if (!transfer.txPayload?.length) {
    throw new Error('SwapKit Sui PTB payload is empty.')
  }

  return {
    case: 'signSui',
    value: create(SignSuiSchema, {
      unsignedTxMsg: Buffer.from(transfer.txPayload).toString('base64'),
    }),
  }
}

/**
 * Route a SwapKit transfer route to the chain-specific pre-built signing
 * payload it needs. Chains whose SwapKit wire shape is a plain native send
 * (TON, XRP, ADA deposits) carry no pre-built bytes and sign through the
 * normal per-chain builder, so they get an empty `signData`.
 */
const getSwapKitSignData = (fromCoin: AccountCoin, transfer: TransferSwapTx): KeysignPayload['signData'] => {
  if (fromCoin.chain === Chain.Bitcoin) {
    return getSwapKitBitcoinSignData(fromCoin, transfer)
  }

  if (fromCoin.chain === Chain.Sui) {
    return getSwapKitSuiSignData(transfer)
  }

  return { case: undefined }
}

/**
 * Builds a KeysignPayload for a swap transaction.
 *
 * Contract: `keysignPayload.toAddress` is always the correct signing destination:
 *   - EVM/Solana swaps: set to the router or swap contract address
 *   - Deposit-channel (transfer) swaps: set to the provider deposit channel address
 *     (from `GeneralSwapTx.transfer.to` via `getSwapDestinationAddress`)
 *
 * UTXO signing (via `getUtxoSigningInputs`) relies on this invariant — it reads
 * `keysignPayload.toAddress` directly for the `general` swap arm.
 */
export const buildSwapKeysignPayload = async ({
  fromCoin,
  toCoin,
  amount,
  swapQuote,
  vaultId,
  localPartyId,
  fromPublicKey,
  toPublicKey,
  libType,
  walletCore,
  gasLimitOverride,
}: BuildSwapKeysignPayloadInput) => {
  const transferTx = matchRecordUnion<SwapQuoteResult, TransferSwapTx | undefined>(swapQuote.quote, {
    native: () => undefined,
    general: ({ tx }) =>
      matchRecordUnion<GeneralSwapTx, TransferSwapTx | undefined>(tx, {
        evm: () => undefined,
        solana: () => undefined,
        transfer: tx => tx,
        cosmosWasm: () => undefined,
        cowswap_order: () => undefined,
      }),
  })
  const cosmosWasmTx = matchRecordUnion<SwapQuoteResult, CosmosWasmSwapTx | undefined>(swapQuote.quote, {
    native: () => undefined,
    general: ({ provider, tx }) => {
      const result = matchRecordUnion<GeneralSwapTx, CosmosWasmSwapTx | undefined>(tx, {
        evm: () => undefined,
        solana: () => undefined,
        transfer: () => undefined,
        cosmosWasm: tx => tx,
        cowswap_order: () => undefined,
      })

      if ((provider === 'ruji') !== !!result) {
        throw new Error('RUJI Trade quotes must use the CosmWasm transaction route.')
      }

      return result
    },
  })
  const cosmosWasmAmount = cosmosWasmTx ? getRujiTradeFundAmount(cosmosWasmTx, fromCoin) : undefined
  const chainAmount = transferTx?.amount ?? cosmosWasmAmount ?? toChainAmount(amount, fromCoin.decimals)

  const fromCoinHexPublicKey = Buffer.from(fromPublicKey.data()).toString('hex')
  const toCoinHexPublicKey = Buffer.from(toPublicKey.data()).toString('hex')

  const thirdPartyGasLimitEstimation = matchRecordUnion<SwapQuoteResult, bigint | undefined>(swapQuote.quote, {
    native: () => undefined,
    general: ({ tx }) =>
      matchRecordUnion<GeneralSwapTx, bigint | undefined>(tx, {
        evm: ({ gasLimit }) => gasLimit,
        solana: () => undefined,
        transfer: () => undefined,
        cosmosWasm: () => undefined,
        cowswap_order: () => undefined,
      }),
  })

  // AGG-03 TODO: CowSwap permitRequired tokens could skip the on-chain approve
  // and sign an EIP-2612 permit instead, but buildEip2612Permit has zero callers
  // and no permit digest reaches the MPC keysign payload yet. Skipping the approve
  // without a wired permit means the solver can't pull the sell token and the order
  // never settles. Keep the normal approve path until the permit flow is fully wired.

  let keysignPayload = create(KeysignPayloadSchema, {
    coin: toCommCoin({
      ...fromCoin,
      hexPublicKey: fromCoinHexPublicKey,
    }),
    toAmount: chainAmount.toString(),
    vaultLocalPartyId: localPartyId,
    vaultPublicKeyEcdsa: vaultId,
    libType,
    toAddress: getSwapDestinationAddress({ quote: swapQuote, fromCoin }),
    utxoInfo: await getKeysignUtxoInfo(fromCoin),
    memo: matchRecordUnion<SwapQuoteResult, string | undefined>(swapQuote.quote, {
      native: ({ memo }) => memo,
      general: ({ tx }) =>
        matchRecordUnion<GeneralSwapTx, string | undefined>(tx, {
          evm: () => undefined,
          solana: () => undefined,
          transfer: ({ memo }) => memo,
          cosmosWasm: () => undefined,
          cowswap_order: () => undefined,
        }),
    }),
    contractPayload: cosmosWasmTx
      ? {
          case: 'wasmExecuteContractPayload',
          value: create(WasmExecuteContractPayloadSchema, {
            senderAddress: cosmosWasmTx.sender,
            contractAddress: cosmosWasmTx.contract,
            executeMsg: cosmosWasmTx.executeMsg,
            coins: cosmosWasmTx.funds,
          }),
        }
      : undefined,
  })

  keysignPayload.swapPayload = matchRecordUnion<SwapQuoteResult, KeysignPayload['swapPayload']>(swapQuote.quote, {
    general: quote => {
      const transfer = matchRecordUnion<GeneralSwapTx, TransferSwapTx | undefined>(quote.tx, {
        evm: () => undefined,
        solana: () => undefined,
        transfer: tx => tx,
        cosmosWasm: () => undefined,
        cowswap_order: () => undefined,
      })

      if (quote.provider === 'swapkit' && transfer) {
        keysignPayload.signData = getSwapKitSignData(fromCoin, transfer)

        return {
          case: 'swapkitSwapPayload',
          value: create(SwapKitSwapPayloadSchema, {
            fromCoin: toCommCoin({
              ...fromCoin,
              hexPublicKey: fromCoinHexPublicKey,
            }),
            toCoin: toCommCoin({
              ...toCoin,
              hexPublicKey: toCoinHexPublicKey,
            }),
            fromAmount: chainAmount.toString(),
            toAmountDecimal: fromChainAmountDisplay(quote.dstAmount, toCoin.decimals),
            txType: transfer.txType ?? '',
            txPayload: transfer.txPayload ?? new Uint8Array(),
            targetAddress: transfer.to,
            ...(transfer.inboundAddress ? { inboundAddress: transfer.inboundAddress } : {}),
            ...(transfer.memo ? { memo: transfer.memo } : {}),
            subProvider: quote.routeProvider ?? '',
            swapId: transfer.swapId ?? '',
          }),
        }
      }

      const txMsg = matchRecordUnion<GeneralSwapTx, Omit<OneInchTransaction, '$typeName'>>(quote.tx, {
        evm: ({ from, to, data, value, affiliateFee }) => {
          return {
            from,
            to,
            data,
            value,
            gasPrice: '',
            gas: 0n,
            swapFee: affiliateFee ? affiliateFee.amount.toString() : '',
            ...(affiliateFee
              ? {
                  swapFeeChain: affiliateFee.chain,
                  swapFeeTokenId: affiliateFee.id,
                  swapFeeDecimals: affiliateFee.decimals,
                }
              : {}),
          }
        },
        solana: ({ data, swapFee }) => ({
          from: '',
          to: '',
          data,
          value: '',
          gasPrice: '',
          gas: BigInt(0),
          swapFee: swapFee.amount.toString(),
          swapFeeChain: swapFee.chain,
          swapFeeTokenId: swapFee.id,
          swapFeeDecimals: swapFee.decimals,
        }),
        // Non-SwapKit transfer routes can still use the existing general display shape.
        // SwapKit transfer routes return above with the dedicated commondata payload.
        transfer: ({ to }) => ({
          from: fromCoin.address,
          to,
          data: '',
          value: '',
          gasPrice: '',
          gas: 0n,
          swapFee: '',
        }),
        cosmosWasm: ({ sender, contract, executeMsg, funds }) => ({
          from: sender,
          to: contract,
          data: executeMsg,
          value: funds[0]?.amount ?? '',
          gasPrice: '',
          gas: 0n,
          swapFee: '',
        }),
        // CowSwap orders are settled off-chain by solvers — there is no on-chain
        // calldata to sign. Instead we serialize the order (everything needed to
        // rebuild the EIP-712 digest and submit it) into `data`, keyed by the
        // `cowswap-order:` marker. The consumer detects the marker, signs the
        // order digest via the EIP-712 path, and POSTs it to the orderbook
        // instead of broadcasting. `to` is the GPv2VaultRelayer (the ERC-20
        // spender) so any required on-chain approval — added below for tokens
        // without sufficient allowance — targets the correct contract.
        cowswap_order: order => ({
          from: fromCoin.address,
          to: COW_VAULT_RELAYER_ADDRESS,
          data: encodeCowSwapKeysignData({
            order: {
              sellToken: order.sellToken,
              buyToken: order.buyToken,
              receiver: order.receiver,
              sellAmount: order.sellAmount,
              buyAmount: order.buyAmount,
              validTo: order.validTo,
              appData: order.appData,
              appDataHash: order.appDataHash,
              feeAmount: order.feeAmount,
              kind: order.kind,
              partiallyFillable: order.partiallyFillable,
              sellTokenBalance: order.sellTokenBalance,
              buyTokenBalance: order.buyTokenBalance,
            },
            chainId: order.chainId,
            apiBase: order.apiBase,
            from: fromCoin.address,
            ...(order.permitRequired ? { permitRequired: true } : {}),
          }),
          value: '',
          gasPrice: '',
          gas: 0n,
          swapFee: '',
        }),
      })

      const tx = create(OneInchTransactionSchema, txMsg)

      const swapPayload: CommKeysignSwapPayload = {
        case: 'oneinchSwapPayload',
        value: create(OneInchSwapPayloadSchema, {
          fromCoin: toCommCoin({
            ...fromCoin,
            hexPublicKey: fromCoinHexPublicKey,
          }),
          toCoin: toCommCoin({
            ...toCoin,
            hexPublicKey: toCoinHexPublicKey,
          }),
          fromAmount: chainAmount.toString(),
          toAmountDecimal: fromChainAmountDisplay(quote.dstAmount, toCoin.decimals),
          quote: create(OneInchQuoteSchema, {
            dstAmount: quote.dstAmount,
            tx,
          }),
          provider: quote.provider,
        }),
      }

      return swapPayload
    },
    native: quote => {
      return nativeSwapQuoteToSwapPayload({
        quote,
        fromCoin: {
          ...fromCoin,
          hexPublicKey: fromCoinHexPublicKey,
        },
        amount: chainAmount,
        toCoin: {
          ...toCoin,
          hexPublicKey: toCoinHexPublicKey,
        },
      })
    },
  })

  keysignPayload.blockchainSpecific = await getChainSpecific({
    keysignPayload,
    walletCore,
    thirdPartyGasLimitEstimation,
    transactionType: cosmosWasmTx ? TransactionType.GENERIC_CONTRACT : undefined,
    isDeposit: matchRecordUnion<SwapQuoteResult, boolean>(swapQuote.quote, {
      native: ({ swapChain }) => areEqualCoins(fromCoin, chainFeeCoin[swapChain]),
      general: () => false,
    }),
  })

  const { chain } = fromCoin

  // Apply an explicit user gas limit (EVM only). The chain-specific resolver
  // has already estimated the gas; here we overwrite just the limit with the
  // caller's value, leaving the computed gas price intact. The 1inch write-back
  // below re-reads `ethereumSpecific.gasLimit`, so it picks up the override too.
  if (gasLimitOverride !== undefined && gasLimitOverride > 0n && isChainOfKind(chain, 'evm')) {
    getBlockchainSpecificValue(keysignPayload.blockchainSpecific, 'ethereumSpecific').gasLimit =
      gasLimitOverride.toString()
  }

  if (
    isChainOfKind(chain, 'evm') &&
    keysignPayload.swapPayload?.case === 'oneinchSwapPayload' &&
    keysignPayload.swapPayload.value.quote?.tx
  ) {
    // It doesn't make sense, as this data is already set in a chain-specific manner, and we will ignore those fields.
    // However, other platforms still expect these fields to be populated.
    const { maxFeePerGasWei, gasLimit } = getBlockchainSpecificValue(
      keysignPayload.blockchainSpecific,
      'ethereumSpecific'
    )
    keysignPayload.swapPayload.value.quote.tx.gasPrice = maxFeePerGasWei
    keysignPayload.swapPayload.value.quote.tx.gas = BigInt(gasLimit)
  }

  if (isChainOfKind(chain, 'evm') && fromCoin.id) {
    const approvalAddress = matchRecordUnion<SwapQuoteResult, string | undefined>(swapQuote.quote, {
      native: () => undefined,
      general: ({ tx }) => ('evm' in tx ? tx.evm.approvalAddress : undefined),
    })
    const spender = approvalAddress ?? keysignPayload.toAddress
    const allowance = await getErc20Allowance({
      chain,
      id: fromCoin.id,
      address: fromCoin.address,
      spender,
    })

    if (allowance < chainAmount) {
      keysignPayload.erc20ApprovePayload = create(Erc20ApprovePayloadSchema, {
        amount: chainAmount.toString(),
        spender,
      })
    }
  }

  if (isChainOfKind(fromCoin.chain, 'utxo')) {
    keysignPayload = await refineKeysignUtxo({
      keysignPayload,
      walletCore,
      publicKey: fromPublicKey,
    })
  }

  return keysignPayload
}
