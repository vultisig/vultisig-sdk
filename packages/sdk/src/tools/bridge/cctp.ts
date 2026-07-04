/**
 * Circle CCTP — Cross-Chain Transfer Protocol contract registry +
 * attestation API client (pure-crypto SDK port).
 *
 * Ported from mcp-ts `src/lib/cctp.ts` (itself a parity port of mcp
 * Go's `internal/cctp/` package, vultisig/mcp#123). The SDK owns the
 * registry + calldata builders; quote/build-unsigned only — this module
 * NEVER signs or broadcasts.
 *
 * # Naming note (mirrored from Go side)
 *
 * The mcp Go side calls this "CCTP V2" but the contract addresses
 * registered here are CCTP V1 contracts (TokenMessenger
 * 0xBd3fa81B...) coupled with the V1 attestation API endpoint. This is
 * the deployment shape Circle supports today. True CCTP V2
 * (TokenMessengerV2) has separate contracts; when/if Vultisig moves to
 * true V2, this file needs a coordinated upgrade.
 *
 * # Supported chains
 *
 * Ethereum (domain 0), Avalanche (1), Optimism (2), Arbitrum (3),
 * Base (6), Polygon (7).
 *
 * CCTP domain IDs are CCTP-specific and DIFFERENT from EVM chain IDs.
 * Do not conflate. We carry the decimal EVM chainId alongside the
 * domain so callers don't have to re-resolve it.
 */

import { EvmChain } from '@vultisig/core-chain/Chain'

/**
 * CCTP contract configuration for a single chain. Mirrors the Go
 * `cctp.ChainConfig` struct, plus the SDK's `EvmChain` enum key and the
 * decimal EVM chain id (so consumers can stamp a canonical tx envelope
 * without a second lookup).
 */
export type CctpChainConfig = {
  /** SDK `EvmChain` enum value for this CCTP chain. */
  chain: EvmChain
  /** Decimal EVM chain id (NOT the CCTP domain). */
  evmChainId: number
  /** CCTP domain ID (0..7), distinct from EVM chain ID. */
  domain: number
  /** TokenMessenger contract — receives `depositForBurn` calls. */
  tokenMessenger: `0x${string}`
  /** MessageTransmitter contract — receives `receiveMessage` calls. */
  messageTransmitter: `0x${string}`
  /** Native USDC contract on this chain. */
  usdc: `0x${string}`
}

/**
 * CCTP V1-contracts registry. Addresses sourced from Circle docs and
 * verified against the mcp Go side (`vultisig/mcp@62efee8`).
 */
export const cctpChains: Record<string, CctpChainConfig> = {
  Ethereum: {
    chain: EvmChain.Ethereum,
    evmChainId: 1,
    domain: 0,
    tokenMessenger: '0xBd3fa81B58Ba92a82136038B25aDec7066af3155',
    messageTransmitter: '0x0a992d191DEeC32aFe36203Ad87D7d289a738F81',
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  },
  Avalanche: {
    chain: EvmChain.Avalanche,
    evmChainId: 43114,
    domain: 1,
    tokenMessenger: '0x6B25532e1060CE10cc3B0A99e5683b91BFDe6982',
    messageTransmitter: '0x8186359aF5F57FbB40c6b14A588d2A59C0C29880',
    usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  },
  Optimism: {
    chain: EvmChain.Optimism,
    evmChainId: 10,
    domain: 2,
    tokenMessenger: '0x2B4069517957735bE00ceE0fadAE88a26365528f',
    messageTransmitter: '0x4D41f22c5a0e5c74090899E5a8Fb597a8842b3e8',
    usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  },
  Arbitrum: {
    chain: EvmChain.Arbitrum,
    evmChainId: 42161,
    domain: 3,
    tokenMessenger: '0x19330d10D9Cc8751218eaf51E8885D058642E08A',
    messageTransmitter: '0xC30362313FBBA5cf9163F0bb16a0e01f01A896ca',
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  },
  Base: {
    chain: EvmChain.Base,
    evmChainId: 8453,
    domain: 6,
    tokenMessenger: '0x1682Ae6375C4E4A97e4B583BC394c861A46D8962',
    messageTransmitter: '0xAD09780d193884d503182aD4F75D113B9B9a86E7',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  Polygon: {
    chain: EvmChain.Polygon,
    evmChainId: 137,
    domain: 7,
    tokenMessenger: '0x9daF8c91AEFAE50b9c0E69629D3F6Ca40cA3B3FE',
    messageTransmitter: '0xF3be9355363857F3e001be68856A2f96b4C39Ba9',
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  },
}

/** List of CCTP-supported chain names, for descriptions / error text. */
export const cctpSupportedChains = Object.keys(cctpChains)

/** Lookup CCTP config for a chain. Returns undefined for unsupported chains. */
export const getCctpChain = (chainName: string): CctpChainConfig | undefined => cctpChains[chainName]

/**
 * Circle CCTP attestation API base URL.
 *
 * The correct, live Circle attestation API is
 * `https://iris-api.circle.com/v1/attestations/{messageHash}` for the
 * V1 contracts in `cctpChains`. The mcp Go #123 `iris-api-v2.circle.com`
 * URL does NOT resolve at the DNS layer (verified during the mcp-ts
 * parity port). When Vultisig moves to true CCTP V2 the API URL may
 * change too — track via Circle docs.
 */
export const cctpAttestationApiBase = 'https://iris-api.circle.com/v1'

/** Circle attestation API response shape. */
export type CctpAttestationResult = {
  /** "complete" | "pending_confirmations" | "not_found" — Circle's literal strings. */
  status: string
  /** 0x-prefixed attestation bytes when status === "complete", otherwise empty. */
  attestation?: string
}
