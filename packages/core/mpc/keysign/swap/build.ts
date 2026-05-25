import { Buffer } from 'buffer'
import { create } from '@bufbuild/protobuf'
import { fromChainAmount } from '@vultisig/core-chain/amount/fromChainAmount'
import { toChainAmount } from '@vultisig/core-chain/amount/toChainAmount'
import { isChainOfKind } from '@vultisig/core-chain/ChainKind'
import { getErc20Allowance } from '@vultisig/core-chain/chains/evm/erc20/getErc20Allowance'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { areEqualCoins } from '@vultisig/core-chain/coin/Coin'
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
import { toCommCoin } from '@vultisig/core-mpc/types/utils/commCoin'
import {
  OneInchQuoteSchema,
  OneInchSwapPayloadSchema,
  OneInchTransaction,
  OneInchTransactionSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/1inch_swap_payload_pb'
import { Erc20ApprovePayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/erc20_approve_payload_pb'
import { KeysignPayload, KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { matchRecordUnion } from '@vultisig/lib-utils/matchRecordUnion'
import { WalletCore } from '@trustwallet/wallet-core'
import { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'

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
}

type TransferSwapTx = Extract<GeneralSwapTx, { transfer: unknown }>['transfer']

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
}: BuildSwapKeysignPayloadInput) => {
  const transferTx = matchRecordUnion<SwapQuoteResult, TransferSwapTx | undefined>(swapQuote.quote, {
    native: () => undefined,
    general: ({ tx }) =>
      matchRecordUnion<GeneralSwapTx, TransferSwapTx | undefined>(tx, {
        evm: () => undefined,
        solana: () => undefined,
        transfer: tx => tx,
      }),
  })
  const chainAmount = transferTx?.amount ?? toChainAmount(amount, fromCoin.decimals)

  const fromCoinHexPublicKey = Buffer.from(fromPublicKey.data()).toString('hex')
  const toCoinHexPublicKey = Buffer.from(toPublicKey.data()).toString('hex')

  const thirdPartyGasLimitEstimation = matchRecordUnion<SwapQuoteResult, bigint | undefined>(swapQuote.quote, {
    native: () => undefined,
    general: ({ tx }) =>
      matchRecordUnion<GeneralSwapTx, bigint | undefined>(tx, {
        evm: ({ gasLimit }) => gasLimit,
        solana: () => undefined,
        transfer: () => undefined,
      }),
  })

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
        }),
    }),
  })

  keysignPayload.swapPayload = matchRecordUnion<SwapQuoteResult, KeysignPayload['swapPayload']>(swapQuote.quote, {
    general: quote => {
      const txMsg = matchRecordUnion<GeneralSwapTx, Omit<OneInchTransaction, '$typeName' | 'swapFee'>>(quote.tx, {
        evm: ({ from, to, data, value }) => {
          return {
            from,
            to,
            data,
            value,
            gasPrice: '',
            gas: 0n,
          }
        },
        solana: ({ data }) => ({
          from: '',
          to: '',
          data,
          value: '',
          gasPrice: '',
          gas: BigInt(0),
        }),
        // Deposit-channel routes (UTXO/Ripple/Tron/Ton sources via Chainflip, NEAR Intents, etc.)
        // send funds to a provider-controlled deposit address. The actual signing uses
        // keysignPayload.toAddress + keysignPayload.memo (set at the KeysignPayload root below),
        // NOT the fields inside this OneInchTransaction stub.
        //
        // Why OneInchTransaction? It is the only SwapPayload variant that cross-platform clients
        // already know how to display in SwapVerify (fromAmount / toAmountDecimal / provider).
        // A dedicated TransferDisplayPayload proto type would require a coordinated proto schema
        // change across all native clients, so we intentionally reuse OneInchTransaction here.
        //
        // Invariant that MUST hold for this to be safe:
        //   - gas = 0n, gasPrice = '', value = '', data = '' (non-EVM signing ignores them)
        //   - from/to are purely informational for the SwapVerify display layer
        // If OneInchTransactionSchema ever adds EVM-only required fields or validation, this
        // arm must be revisited to either (a) introduce a dedicated payload type, or (b) keep
        // sending zero/empty values and ensure the schema still accepts them.
        transfer: ({ to }) => ({
          from: fromCoin.address,
          to,
          data: '',
          value: '',
          gasPrice: '',
          gas: 0n,
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
          toAmountDecimal: fromChainAmount(quote.dstAmount, toCoin.decimals).toFixed(toCoin.decimals),
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
    isDeposit: matchRecordUnion<SwapQuoteResult, boolean>(swapQuote.quote, {
      native: ({ swapChain }) => areEqualCoins(fromCoin, chainFeeCoin[swapChain]),
      general: () => false,
    }),
  })

  const { chain } = fromCoin

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
    const spender = keysignPayload.toAddress
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
    keysignPayload = refineKeysignUtxo({
      keysignPayload,
      walletCore,
      publicKey: fromPublicKey,
    })
  }

  return keysignPayload
}
