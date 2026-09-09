import { assertBittensorAddress, decodeBittensorAddress } from '../../tools/balance/bittensor'
import { cosmosBalanceChains, getCosmosBalance, isCosmosBalanceChain } from '../../tools/balance/cosmos'
import {
  getCardanoBalance,
  getSuiAllBalances,
  getSuiBalance,
  getSuiTokenBalance,
  getTonBalance,
  getTonJettonBalance,
  getTrc20TokenBalance,
  getTronAccountResources,
  getTrxBalance,
  getXrpBalance,
} from '../../tools/balance/otherBalance'
import { DOT_DECIMALS, formatDot } from '../../tools/balance/polkadotFormat'
import { formatBalance } from '../../tools/balance/rpc'
import { getSolBalance, getSplTokenBalance } from '../../tools/balance/solana'
import { getTaoBalance } from '../../tools/balance/taoBalance'
import { formatUtxoBalance, getUtxoBalance, supportedUtxoBalanceChains } from '../../tools/balance/utxoBalance'
import * as bridge from '../../tools/bridge'
import * as cosmos from '../../tools/cosmos'
import { decode } from '../../tools/decode'
import { getEvmBalances } from '../../tools/evm/balanceEvm'
import * as gas from '../../tools/gas'
import * as cosmosStaking from '../../tools/prep/cosmosStaking'
import * as cosmosWasmExecute from '../../tools/prep/cosmosWasmExecute'
import * as cw20Transfer from '../../tools/prep/cw20Transfer'
import * as ibcTransfer from '../../tools/prep/ibcTransfer'
import * as polkadotAssetSend from '../../tools/prep/polkadotAssetSend'
import * as suiTokenTransfer from '../../tools/prep/suiTokenTransfer'
import { SwapQuoteExpiredError } from '../../tools/prep/SwapQuoteExpiredError'
import * as trc20 from '../../tools/prep/trc20'
import { CONSOLIDATE_CHAINS } from '../../tools/prep/utxoConsolidateChains'
import * as price from '../../tools/price'
import * as swap from '../../tools/swap'

type AnyFunction = (...args: any[]) => any

const lazyFunction =
  <T extends AnyFunction>(
    load: () => Promise<Record<string, unknown>>,
    name: string
  ): ((...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>>) =>
  async (...args: Parameters<T>) => {
    const module = await load()
    return (module[name] as T)(...args)
  }

const balancePolkadot = lazyFunction<typeof import('../../tools/balance/polkadot').balancePolkadot>(
  () => import('../../tools/balance/polkadot'),
  'balancePolkadot'
)
const getPolkadotNativeBalance = lazyFunction<typeof import('../../tools/balance/polkadot').getPolkadotNativeBalance>(
  () => import('../../tools/balance/polkadot'),
  'getPolkadotNativeBalance'
)
const getPolkadotAssetBalance = lazyFunction<typeof import('../../tools/balance/polkadot').getPolkadotAssetBalance>(
  () => import('../../tools/balance/polkadot'),
  'getPolkadotAssetBalance'
)

const balance = {
  getEvmBalances,
  getXrpBalance,
  getTrc20TokenBalance,
  getTronAccountResources,
  getTrxBalance,
  getTonBalance,
  getTonJettonBalance,
  getSuiAllBalances,
  getSuiBalance,
  getSuiTokenBalance,
  getCardanoBalance,
  getTaoBalance,
  assertBittensorAddress,
  decodeBittensorAddress,
  cosmosBalanceChains,
  getCosmosBalance,
  isCosmosBalanceChain,
  formatBalance,
  getSolBalance,
  getSplTokenBalance,
  balancePolkadot,
  DOT_DECIMALS,
  formatDot,
  getPolkadotAssetBalance,
  getPolkadotNativeBalance,
  formatUtxoBalance,
  getUtxoBalance,
  supportedUtxoBalanceChains,
}

const prepareContractCallTxFromKeys = lazyFunction<
  typeof import('../../tools/prep/contractCall').prepareContractCallTxFromKeys
>(() => import('../../tools/prep/contractCall'), 'prepareContractCallTxFromKeys')
const prepareSignAminoTxFromKeys = lazyFunction<typeof import('../../tools/prep/cosmos').prepareSignAminoTxFromKeys>(
  () => import('../../tools/prep/cosmos'),
  'prepareSignAminoTxFromKeys'
)
const prepareSignDirectTxFromKeys = lazyFunction<typeof import('../../tools/prep/cosmos').prepareSignDirectTxFromKeys>(
  () => import('../../tools/prep/cosmos'),
  'prepareSignDirectTxFromKeys'
)
const prepareJettonTransferTxFromKeys = lazyFunction<
  typeof import('../../tools/prep/jettonTransfer').prepareJettonTransferTxFromKeys
>(() => import('../../tools/prep/jettonTransfer'), 'prepareJettonTransferTxFromKeys')
const getMaxSendAmountFromKeys = lazyFunction<typeof import('../../tools/prep/maxSend').getMaxSendAmountFromKeys>(
  () => import('../../tools/prep/maxSend'),
  'getMaxSendAmountFromKeys'
)
const prepareRawEvmTxFromKeys = lazyFunction<typeof import('../../tools/prep/rawEvm').prepareRawEvmTxFromKeys>(
  () => import('../../tools/prep/rawEvm'),
  'prepareRawEvmTxFromKeys'
)
const prepareSendTxFromKeys = lazyFunction<typeof import('../../tools/prep/send').prepareSendTxFromKeys>(
  () => import('../../tools/prep/send'),
  'prepareSendTxFromKeys'
)
const buildSplTransfer = lazyFunction<typeof import('../../tools/prep/splTransfer').buildSplTransfer>(
  () => import('../../tools/prep/splTransfer'),
  'buildSplTransfer'
)
const prepareSwapTxFromKeys = lazyFunction<typeof import('../../tools/prep/swap').prepareSwapTxFromKeys>(
  () => import('../../tools/prep/swap'),
  'prepareSwapTxFromKeys'
)
const prepareThorchainMsgDepositTxFromKeys = lazyFunction<
  typeof import('../../tools/prep/thorchainMsgDeposit').prepareThorchainMsgDepositTxFromKeys
>(() => import('../../tools/prep/thorchainMsgDeposit'), 'prepareThorchainMsgDepositTxFromKeys')
const prepareUtxoConsolidateTxFromKeys = lazyFunction<
  typeof import('../../tools/prep/utxoConsolidate').prepareUtxoConsolidateTxFromKeys
>(() => import('../../tools/prep/utxoConsolidate'), 'prepareUtxoConsolidateTxFromKeys')

const prep = {
  prepareContractCallTxFromKeys,
  prepareSignAminoTxFromKeys,
  prepareSignDirectTxFromKeys,
  ...cosmosStaking,
  ...cosmosWasmExecute,
  ...cw20Transfer,
  ...ibcTransfer,
  prepareJettonTransferTxFromKeys,
  getMaxSendAmountFromKeys,
  ...polkadotAssetSend,
  prepareRawEvmTxFromKeys,
  prepareSendTxFromKeys,
  buildSplTransfer,
  ...suiTokenTransfer,
  prepareSwapTxFromKeys,
  SwapQuoteExpiredError,
  prepareThorchainMsgDepositTxFromKeys,
  ...trc20,
  CONSOLIDATE_CHAINS,
  prepareUtxoConsolidateTxFromKeys,
}

export const reactNativeVultisigInstanceNamespaces = {
  balance,
  bridge,
  cosmos,
  decode,
  gas,
  prep,
  price,
  swap,
}

export type ReactNativeVultisigInstanceNamespaces = typeof reactNativeVultisigInstanceNamespaces
