import { Buffer } from 'buffer'
import { create } from '@bufbuild/protobuf'
import { Chain, EvmChain } from '@vultisig/core-chain/Chain'
import { getErc20Allowance } from '@vultisig/core-chain/chains/evm/erc20/getErc20Allowance'
import { toEvmTwAmount } from '@vultisig/core-chain/chains/evm/tx/tw/toEvmTwAmount'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { Coin } from '@vultisig/core-chain/coin/Coin'
import { getChainSpecific } from '@vultisig/core-mpc/keysign/chainSpecific'
import { toTwAddress } from '@vultisig/core-mpc/keysign/tw/toTwAddress'
import { KeysignLibType } from '@vultisig/core-mpc/mpcLib'
import { toCommCoin } from '@vultisig/core-mpc/types/utils/commCoin'
import { Erc20ApprovePayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/erc20_approve_payload_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { WalletCore } from '@trustwallet/wallet-core'
import { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'

/**
 * VULT staking (sVULT) is an EVM ERC20-wrapper on Ethereum mainnet. Every action
 * is a raw contract call.
 *
 * Stake mirrors the swap-with-approval pattern: the payload's `coin` is the VULT
 * token, so the shared EVM resolver can attach an `erc20ApprovePayload` (approve
 * VULT → sVULT) as a first signing input, and the `depositFor` calldata in `memo`
 * is emitted as a generic contract call to sVULT as the second input. Both are
 * signed in one ceremony and broadcast back-to-back (approve at nonce N, deposit
 * at N+1), so the allowance is in place before depositFor executes.
 *
 * Unstake / claim / cancel need no approval and act on sVULT directly, so they
 * use the native fee coin + `memo` shape (like Circle withdraw).
 */
export type BuildVultStakingKeysignPayloadInput = {
  vaultAddress: string
  vaultId: string
  localPartyId: string
  publicKey: PublicKey
  libType: KeysignLibType
  walletCore: WalletCore
}

const encodeDepositFor = ({
  account,
  value,
  walletCore,
}: {
  account: string
  value: bigint
  walletCore: WalletCore
}): string => {
  const fn = walletCore.EthereumAbiFunction.createWithString('depositFor')
  fn.addParamAddress(toTwAddress({ address: account, walletCore, chain: Chain.Ethereum }), false)
  fn.addParamUInt256(toEvmTwAmount(value), false)
  return `0x${Buffer.from(walletCore.EthereumAbi.encode(fn)).toString('hex')}`
}

const encodeRequestUnstake = ({ amount, walletCore }: { amount: bigint; walletCore: WalletCore }): string => {
  const fn = walletCore.EthereumAbiFunction.createWithString('requestUnstake')
  fn.addParamUInt256(toEvmTwAmount(amount), false)
  return `0x${Buffer.from(walletCore.EthereumAbi.encode(fn)).toString('hex')}`
}

const encodeClaim = ({
  requestId,
  receiver,
  walletCore,
}: {
  requestId: bigint
  receiver: string
  walletCore: WalletCore
}): string => {
  const fn = walletCore.EthereumAbiFunction.createWithString('claim')
  fn.addParamUInt256(toEvmTwAmount(requestId), false)
  fn.addParamAddress(toTwAddress({ address: receiver, walletCore, chain: Chain.Ethereum }), false)
  return `0x${Buffer.from(walletCore.EthereumAbi.encode(fn)).toString('hex')}`
}

const encodeCancelUnstake = ({ requestId, walletCore }: { requestId: bigint; walletCore: WalletCore }): string => {
  const fn = walletCore.EthereumAbiFunction.createWithString('cancelUnstake')
  fn.addParamUInt256(toEvmTwAmount(requestId), false)
  return `0x${Buffer.from(walletCore.EthereumAbi.encode(fn)).toString('hex')}`
}

/** Raw call to sVULT signed via the native fee coin + `memo` (no token transfer). */
const buildNativeContractCallPayload = async ({
  input,
  toAddress,
  memo,
}: {
  input: BuildVultStakingKeysignPayloadInput
  toAddress: string
  memo: string
}) => {
  const { vaultAddress, vaultId, localPartyId, publicKey, libType, walletCore } = input

  const nativeCoin = {
    ...chainFeeCoin[Chain.Ethereum],
    address: vaultAddress,
  }

  const keysignPayload = create(KeysignPayloadSchema, {
    coin: toCommCoin({
      ...nativeCoin,
      hexPublicKey: Buffer.from(publicKey.data()).toString('hex'),
    }),
    toAddress,
    toAmount: '0',
    memo,
    vaultLocalPartyId: localPartyId,
    vaultPublicKeyEcdsa: vaultId,
    libType,
  })

  keysignPayload.blockchainSpecific = await getChainSpecific({
    keysignPayload,
    walletCore,
  })

  return keysignPayload
}

/**
 * `sVULT.depositFor(vault, amount)`, prefixed with `VULT.approve(sVULT, amount)`
 * when the current allowance is insufficient. Both are emitted as signing inputs
 * and broadcast in a single ceremony.
 */
export const buildVultStakeKeysignPayload = async ({
  underlyingToken,
  stakingContractAddress,
  amount,
  ...input
}: BuildVultStakingKeysignPayloadInput & {
  underlyingToken: Coin
  stakingContractAddress: string
  amount: bigint
}) => {
  const { vaultAddress, vaultId, localPartyId, publicKey, libType, walletCore } = input

  const tokenId = shouldBePresent(underlyingToken.id, 'VULT token id')

  const keysignPayload = create(KeysignPayloadSchema, {
    coin: toCommCoin({
      ...underlyingToken,
      address: vaultAddress,
      hexPublicKey: Buffer.from(publicKey.data()).toString('hex'),
    }),
    toAddress: stakingContractAddress,
    toAmount: '0',
    memo: encodeDepositFor({ account: vaultAddress, value: amount, walletCore }),
    vaultLocalPartyId: localPartyId,
    vaultPublicKeyEcdsa: vaultId,
    libType,
  })

  const allowance = await getErc20Allowance({
    chain: underlyingToken.chain as EvmChain,
    id: tokenId,
    address: vaultAddress,
    spender: stakingContractAddress,
  })

  if (allowance < amount) {
    keysignPayload.erc20ApprovePayload = create(Erc20ApprovePayloadSchema, {
      amount: amount.toString(),
      spender: stakingContractAddress,
    })
  }

  keysignPayload.blockchainSpecific = await getChainSpecific({
    keysignPayload,
    walletCore,
  })

  return keysignPayload
}

/** `sVULT.requestUnstake(amount)` — starts the cooldown for `amount` of sVULT. */
export const buildVultUnstakeKeysignPayload = ({
  stakingContractAddress,
  amount,
  ...input
}: BuildVultStakingKeysignPayloadInput & {
  stakingContractAddress: string
  amount: bigint
}) =>
  buildNativeContractCallPayload({
    input,
    toAddress: stakingContractAddress,
    memo: encodeRequestUnstake({ amount, walletCore: input.walletCore }),
  })

/** `sVULT.claim(requestId, vault)` — returns the underlying VULT once matured. */
export const buildVultClaimKeysignPayload = ({
  stakingContractAddress,
  requestId,
  ...input
}: BuildVultStakingKeysignPayloadInput & {
  stakingContractAddress: string
  requestId: bigint
}) =>
  buildNativeContractCallPayload({
    input,
    toAddress: stakingContractAddress,
    memo: encodeClaim({
      requestId,
      receiver: input.vaultAddress,
      walletCore: input.walletCore,
    }),
  })

/** `sVULT.cancelUnstake(requestId)` — cancels a pending request and restores sVULT. */
export const buildVultCancelUnstakeKeysignPayload = ({
  stakingContractAddress,
  requestId,
  ...input
}: BuildVultStakingKeysignPayloadInput & {
  stakingContractAddress: string
  requestId: bigint
}) =>
  buildNativeContractCallPayload({
    input,
    toAddress: stakingContractAddress,
    memo: encodeCancelUnstake({ requestId, walletCore: input.walletCore }),
  })
