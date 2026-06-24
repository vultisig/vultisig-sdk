/**
 * React Native platform entry point
 *
 * Registers the native MPC engine, native WalletCore, RN crypto, and RN storage.
 * Exports RN-compatible SDK APIs.
 */

// Buffer polyfill MUST happen before any SDK module graph import. Several
// bundled deps read `globalThis.Buffer` at module-init (e.g. @solana/web3.js,
// @noble/*, @polkadot/*). Consumers often polyfill Buffer in App.tsx, but
// because ES module imports are hoisted, the SDK's module bodies can evaluate
// before App.tsx's polyfill runs. Polyfilling here guarantees ordering.
import { Buffer as _Buffer } from 'buffer'
if (typeof globalThis !== 'undefined' && !(globalThis as { Buffer?: unknown }).Buffer) {
  ;(globalThis as { Buffer?: unknown }).Buffer = _Buffer
}

// Hermes polyfills — RN-only. These run for side effects at module load so
// that any chain-lib module body that evaluates `new Intl.PluralRules(...)`
// or `class X extends Event` can resolve those globals without crashing.
//
// - @mysten/sui/dist/client/utils.mjs evaluates `new Intl.PluralRules(...)`
//   at module top-level. Hermes ships without Intl.PluralRules.
// - @lifi/sdk's transitive `@wallet-standard/app` declares
//   `class AppReadyEvent extends Event` at module top-level. Hermes ships
//   without the `Event`/`EventTarget` DOM globals.
//
// Intl.PluralRules' own ResolveLocale reaches into Intl.Locale, and the
// ordinal PluralRules constructor used by @mysten/sui also reaches into
// Intl.NumberFormat — all four sub-APIs are absent on Hermes. Install the
// full cascade in dependency order: getCanonicalLocales → Locale →
// NumberFormat → PluralRules.
//
// Without these, even lazy `import('@mysten/sui/jsonRpc')` /
// `import('@lifi/sdk')` crashes the first time the module is evaluated.
import '@formatjs/intl-getcanonicallocales/polyfill.js'
import '@formatjs/intl-locale/polyfill.js'
import '@formatjs/intl-numberformat/polyfill.js'
import '@formatjs/intl-numberformat/locale-data/en.js'
import '@formatjs/intl-pluralrules/polyfill.js'
import '@formatjs/intl-pluralrules/locale-data/en.js'
import 'event-target-polyfill'

import { NativeMpcEngine } from '@vultisig/mpc-native'
import { configureMpc } from '@vultisig/mpc-types'
import { NativeWalletCore } from '@vultisig/walletcore-native'

import { configureDefaultStorage } from '../../context/defaultStorage'
import { configureWasm } from '../../context/wasmRuntime'
import { configureCrypto } from '../../crypto'
import { ReactNativeCrypto } from './crypto'
import { ReactNativeStorage } from './storage'

// Register native MPC engine
configureMpc(new NativeMpcEngine())

// Register native WalletCore as the WalletCore provider
configureWasm(async () => NativeWalletCore.getInstance())

// Register RN crypto (validates globalThis.crypto polyfill on first use)
configureCrypto(new ReactNativeCrypto())

// Register AsyncStorage-backed default storage
configureDefaultStorage(() => new ReactNativeStorage())

// Chain enum and types
export { Chain } from '@vultisig/core-chain/Chain'

// WalletCore type compatible with both @trustwallet/wallet-core and @vultisig/walletcore-native
export type { WalletCoreLike } from '@vultisig/walletcore-native'

// Address derivation and chain utilities
// RN wrappers accept WalletCoreLike from @vultisig/walletcore-native
// so consumers don't need to cast to @trustwallet/wallet-core's WalletCore.
export { deriveAddress, getCoinType, getPublicKey, isValidAddress } from './chainHelpers'

// MPC keysign (uses MpcEngine — no direct WASM imports)
export { keysign } from '@vultisig/core-mpc/keysign'

// Seedphrase validation (uses @scure/bip39, RN-compatible)
export { validateSeedphrase } from '../../seedphrase/SeedphraseValidator'
export { SEEDPHRASE_WORD_COUNTS } from '../../seedphrase/types'

// WalletCore provider access
export { configureWasm, getWalletCore } from '../../context/wasmRuntime'

// MPC engine access (for advanced usage)
export type { MpcEngine, MpcKeyshare, MpcMessage, MpcSession } from '@vultisig/mpc-types'
export { configureMpc, ensureMpcEngine, getMpcEngine } from '@vultisig/mpc-types'

// Vault + fast vault lifecycle classes
export { FastVaultFromSeedphraseService } from '../../services/FastVaultFromSeedphraseService'
export { FastVault } from '../../vault/FastVault'
export { VaultManager } from '../../VaultManager'
export type { VultisigConfig } from '../../Vultisig'
export { Vultisig } from '../../Vultisig'

// RN-safe fetch-based RPC helpers (no Node net/tls/http/ws dependency)
export type { JsonRpcCallOptions, JsonRpcParams, JsonRpcResponse } from './rpcFetch'
export { jsonRpcCall, JsonRpcError, queryUrl } from './rpcFetch'

// RN runtime config registry — consumers inject chain RPC URLs and
// optional server/relay URL overrides at app boot. Vendored RN bridges
// (cosmos/sui/utxo + MPC helpers) read lazily from this registry.
export type { RuntimeConfig } from './runtime'
export { configureRuntime } from './runtime'

// RN-safe MPC ceremony helpers — vendored from app's auth/fastVaultSign
// and mpc/schnorrSign, wired to SDK's `keysign`. No VultiServer URL
// hardcoding: consumers pass via opts or configureRuntime() defaults.
export type { FastVaultSignOptions, RelaySessionOptions, SchnorrSignOptions } from './mpc'
export { fastVaultSign, joinRelaySession, schnorrSign, startRelaySession, waitForParties } from './mpc'

// RN-safe per-chain bridges — pure-function primitives vendored from the
// vultiagent-app hand-rolled implementations. Consumers do fetch +
// signing + broadcasting; these expose the encoding + address math.
//
// Cosmos (bech32 addresses, protobuf tx encoding, THORChain MsgDeposit)
// Sui (address derivation, intent-hashing, signature serialization)
// EVM (viem-backed tx builders + RPC helpers for all 13 EVM chains)
// TON (wallet V4R2 BOC cell encoding, toncenter RPC helpers)
export { chains } from './chains'

// EVM bridge type surface — consumers can import these directly from the RN
// entry without reaching through `chains.evm.*`.
export type {
  BuildErc20ApproveOptions,
  BuildErc20TransferOptions,
  BuildEvmContractCallOptions,
  BuildEvmSendOptions,
  EvmTxBuilderResult,
} from './chains/evm'

// Solana bridge type surface — pure primitive reimplementation that does NOT
// pull @solana/web3.js (and therefore avoids the rpc-websockets / ws cascade
// that hangs Hermes at module init).
export type { BuildSolanaSendOptions, SolanaTxBuilderResult } from './chains/solana'

// TON bridge type surface — reimplementation built on @ton/core only, which
// is Hermes-safe (uses jssha via @ton/crypto peer dep, not crypto.subtle).
// Consumers MUST install `@ton/core` as a peer dep; we never reach into
// `@ton/crypto-primitives`.
export type {
  BuildTonJettonTransferOptions,
  BuildTonSendOptions,
  TonTxBuilderResult,
  TonV4R2Wallet,
  TonWalletInfo,
  TonWalletStatus,
} from './chains/ton'

// ============================================================================
// Chain tools — RN-safe surface re-exported for consumers
// ============================================================================
//
// These helpers work on RN because heavy chain clients (viem, xrpl,
// @solana/web3.js, @ton/*, @polkadot/util-crypto, bitcoinjs-lib, @cosmjs/*,
// @mysten/sui/jsonRpc, @lifi/sdk, @bufbuild/protobuf, cbor-x, i18next)
// are externalized in rollup.platforms.config.js. Consumers must install
// those they actually reach (or metro-stub the rest). `bip32` is inlined
// from its real (pure-JS) npm package, and `tiny-secp256k1` is inlined
// via the noble-backed shim at
// src/platforms/react-native/shims/tiny-secp256k1.ts.

// Vault-free prep helpers (KeysignPayload construction without an instantiated vault)
export type {
  ConsolidateChain,
  ConsolidateUtxo,
  GetMaxSendAmountFromKeysParams,
  PrepareJettonTransferTxFromKeysParams,
  PrepareSendTxFromKeysParams,
  PrepareSwapTxFromKeysParams,
  PrepareUtxoConsolidateResult,
  PrepareUtxoConsolidateTxFromKeysParams,
  VaultIdentity,
} from '../../tools/prep'

export async function getMaxSendAmountFromKeys(...args: unknown[]) {
  const mod = await import('../../tools/prep/maxSend')
  return mod.getMaxSendAmountFromKeys(...(args as Parameters<typeof mod.getMaxSendAmountFromKeys>))
}

export async function prepareContractCallTxFromKeys(...args: unknown[]) {
  const mod = await import('../../tools/prep/contractCall')
  return mod.prepareContractCallTxFromKeys(...(args as Parameters<typeof mod.prepareContractCallTxFromKeys>))
}

export async function prepareJettonTransferTxFromKeys(...args: unknown[]) {
  const mod = await import('../../tools/prep/jettonTransfer')
  return mod.prepareJettonTransferTxFromKeys(...(args as Parameters<typeof mod.prepareJettonTransferTxFromKeys>))
}

export async function prepareSendTxFromKeys(...args: unknown[]) {
  const mod = await import('../../tools/prep/send')
  return mod.prepareSendTxFromKeys(...(args as Parameters<typeof mod.prepareSendTxFromKeys>))
}

export async function prepareSignAminoTxFromKeys(...args: unknown[]) {
  const mod = await import('../../tools/prep/cosmos')
  return mod.prepareSignAminoTxFromKeys(...(args as Parameters<typeof mod.prepareSignAminoTxFromKeys>))
}

export async function prepareSignDirectTxFromKeys(...args: unknown[]) {
  const mod = await import('../../tools/prep/cosmos')
  return mod.prepareSignDirectTxFromKeys(...(args as Parameters<typeof mod.prepareSignDirectTxFromKeys>))
}

export async function prepareSwapTxFromKeys(...args: unknown[]) {
  const mod = await import('../../tools/prep/swap')
  return mod.prepareSwapTxFromKeys(...(args as Parameters<typeof mod.prepareSwapTxFromKeys>))
}

export async function prepareUtxoConsolidateTxFromKeys(...args: unknown[]) {
  const mod = await import('../../tools/prep/utxoConsolidate')
  return mod.prepareUtxoConsolidateTxFromKeys(...(args as Parameters<typeof mod.prepareUtxoConsolidateTxFromKeys>))
}

// Astroport in-chain swap (Terra v2 / phoenix-1) — builds an unsigned
// wasm_execute envelope. Pure-crypto: only @scure/base (bech32), Buffer and
// fetch, all RN-safe, so a static re-export is fine (no chain-client deps to
// externalize). The RN consumer (Station / vultiagent-app) needs this to build
// the signable Terra swap msg; omitting it would force a re-implementation.
export type { AstroportSwapResult, BuildAstroportSwapParams } from '../../tools/swap/astroport'
export {
  assembleAstroportSwap,
  ASTROPORT_ROUTER,
  buildAstroportSwap,
  classifyAstroportAsset,
  computeAstroportMinReceive,
  TERRA_CHAIN_ID,
  TERRA_LCD,
} from '../../tools/swap/astroport'

// EVM utilities (viem-backed — requires app to install `viem` as a peer dep)
export type { GetTokenApprovalsResult, TokenApproval } from '../../tools/evm'
export {
  abiDecode,
  abiEncode,
  evmCall,
  evmCheckAllowance,
  evmTxInfo,
  getTokenApprovals,
  resolve4ByteSelector,
  resolveEns,
} from '../../tools/evm'

// DeFi protocol primitives (unsigned calldata builders) — sdk.defi.*
// Pure builders, RN-safe. Statically re-exported so RN consumers can reach
// the full defi namespace (arkis + balancer + glif + pendle + 3jane).
export type {
  BalancerTokenApi,
  BalancerV3SwapCalldata,
  BalancerV3SwapKind,
  BalancerV3SwapPath,
  BuildBalancerV3SwapCalldataParams,
  BuildGlifRedeemParams,
  BuildGlifRedeemResult,
  BuildGlifStakeParams,
  BuildGlifStakeResult,
  Defi,
  GlifUnsignedTx,
} from '../../tools/defi'
export { buildBalancerV3SwapCalldata, defi } from '../../tools/defi'
export {
  buildGlifRedeemSticnt,
  buildGlifStakeIcnt,
  GLIF_ICN_BASE_ADDRESSES,
  GLIF_ICN_TOKEN_DECIMALS,
  glifPoolWriteAbi,
} from '../../tools/defi/glif'
export type {
  BuildThreeJaneSupplyUsdcParams,
  BuildThreeJaneSupplyUsdcResult,
  ThreeJaneTranche,
  ThreeJaneTxStep,
} from '../../tools/defi/threeJane'

// Cosmos staking + distribution module (LCD queries — read-only,
// vault-free, generic over every ibcEnabled cosmos chain). Mirrors the
// generic entry (src/index.ts); the React Native allow-list omitted
// these so RN consumers couldn't read delegations/rewards/unbonding/
// vesting and had to hand-roll an LCD client. Signing primitives still
// ship via `chains.cosmos.buildCosmosStakingTx` (already RN-exported).
export type {
  ContinuousVestingAccount,
  Coin as CosmosStakingCoin,
  DelayedVestingAccount,
  Delegation,
  DelegatorReward,
  DelegatorRewardsResponse,
  PeriodicVestingAccount,
  UnbondingDelegation,
  UnbondingEntry,
  VestingAccount,
} from '@vultisig/core-chain/chains/cosmos/staking/lcdQueries'
export {
  getAuthAccountUrl,
  getCosmosDelegations,
  getCosmosDelegatorRewards,
  getCosmosUnbondingDelegations,
  getCosmosVestingAccount,
  getDelegationsUrl,
  getDelegatorRewardsUrl,
  getUnbondingDelegationsUrl,
} from '@vultisig/core-chain/chains/cosmos/staking/lcdQueries'

// Cosmos governance — read proposals + build unsigned MsgVote envelope.
// Pure LCD reads + a pure-crypto unsigned-envelope builder (bech32 via
// @cosmjs/encoding, already externalized for RN; no MPC/WASM). The generic
// entry (src/index.ts) exports these too; the RN allow-list omitted them so
// RN consumers (windows/extension, Station) couldn't read gov proposals or
// build an unsigned vote without re-porting the chain registry.
export type {
  CosmosVoteEnvelope,
  GetCosmosGovernanceProposalsParams,
  GetGovernanceProposalsResult,
  GovChain,
  GovernanceProposal,
  PrepareCosmosVoteParams,
  ProposalStatus,
  VoteOption,
  VoteTally,
} from '../../tools/cosmos'
export { getCosmosGovernanceProposals, prepareCosmosVote } from '../../tools/cosmos'

// Token utilities
export type {
  Coin,
  CoinKey,
  CoinMetadata,
  KnownCoin,
  KnownCoinMetadata,
  TokenMetadataResolver,
} from '../../tools/token'
export { chainFeeCoin, getTokenMetadata, knownTokens, knownTokensIndex, searchToken } from '../../tools/token'

// DEX primitives — read-only on-chain quotes + pure math. No signing, no broadcast.
// RN-safe: uniswapV2Quote/getAmountOut are pure bigint math; balancerQuote is
// pure @balancer-labs/balancer-maths; uniswap.* are pure tick math + evmCall.
export * as dex from '../../tools/dex'

// Address derivation from raw vault identity
export { deriveAddressFromKeys } from '../../tools/address'

// Atomic chain helpers (balance fetchers, vault-free)
export { getCoinBalance } from './getCoinBalance'

// Pure helpers — no chain client deps
export { computeNotificationVaultId } from '../../utils/computeNotificationVaultId'
export { FiatToAmountError } from '../../utils/fiatToAmount'
export async function fiatToAmount(...args: unknown[]) {
  const mod = await import('../../utils/fiatToAmount')
  return mod.fiatToAmount(...(args as Parameters<typeof mod.fiatToAmount>))
}
export { normalizeChain, UnknownChainError } from '../../utils/normalizeChain'
export async function parseKeygenQR(...args: unknown[]) {
  const mod = await import('../../utils/parseKeygenQR')
  return mod.parseKeygenQR(...(args as Parameters<typeof mod.parseKeygenQR>))
}
export { ValidationHelpers } from '../../utils/validation'

// Storage
export { MemoryStorage } from '../../storage/MemoryStorage'

// Event emitter
export { UniversalEventEmitter } from '../../events/EventEmitter'
