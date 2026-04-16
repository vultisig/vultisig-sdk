import type { WalletCore } from '@trustwallet/wallet-core'
import { isChainOfKind } from '@vultisig/core-chain/ChainKind'
import type { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { getPublicKey } from '@vultisig/core-chain/publicKey/getPublicKey'
import { buildSendKeysignPayload } from '@vultisig/core-mpc/keysign/send/build'
import type { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { type Abi, encodeFunctionData } from 'viem'

import { getWalletCore } from '../../context/wasmRuntime'
import type { ContractCallTxParams } from '../../types/contractCall'
import type { VaultIdentity } from './types'

/**
 * Vault-free version of TransactionBuilder.prepareContractCallTx.
 *
 * Encodes an EVM contract function call via ABI then builds a native-coin
 * KeysignPayload with the calldata as `memo`. Supports zero-value calls
 * (approvals, governance votes, etc.) and value-bearing calls.
 *
 * Useful for MCP servers / agent backends that hold raw vault identity
 * (public keys, party id) but no full vault instance.
 *
 * `walletCore` is optional; when omitted, falls back to the SDK's globally-configured
 * `getWalletCore()` (used by MCP / vault-free callers). Wrappers with an injected
 * `WasmProvider` should pass it explicitly.
 */
export const prepareContractCallTxFromKeys = async (
  identity: VaultIdentity,
  params: ContractCallTxParams,
  walletCoreOverride?: WalletCore
): Promise<KeysignPayload> => {
  const { chain, contractAddress, abi, functionName, args, value = 0n, senderAddress, feeSettings } = params

  if (!isChainOfKind(chain, 'evm')) {
    throw new Error(`prepareContractCallTxFromKeys only supports EVM chains. Got: ${chain}`)
  }

  if (value < 0n) {
    throw new Error('Contract call value cannot be negative')
  }

  const calldata = encodeFunctionData({
    abi: abi as Abi,
    functionName,
    args: args ?? [],
  })

  const native = chainFeeCoin[chain]
  const coin: AccountCoin = {
    chain,
    address: senderAddress,
    decimals: native.decimals,
    ticker: native.ticker,
  }

  const walletCore = walletCoreOverride ?? (await getWalletCore())

  const publicKey = getPublicKey({
    chain,
    walletCore,
    publicKeys: {
      ecdsa: identity.ecdsaPublicKey,
      eddsa: identity.eddsaPublicKey,
    },
    hexChainCode: identity.hexChainCode,
  })

  return buildSendKeysignPayload({
    coin,
    receiver: contractAddress,
    amount: value,
    memo: calldata,
    vaultId: identity.ecdsaPublicKey,
    localPartyId: identity.localPartyId,
    publicKey,
    walletCore,
    libType: identity.libType,
    feeSettings,
  })
}
