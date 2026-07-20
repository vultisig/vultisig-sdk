import { PublicKey as SolanaPublicKey } from '@solana/web3.js'
import { assertSafeSolanaSwapTransactionBase64 } from '@vultisig/core-chain/chains/solana/assertSafeSolanaSwapInstructions'
import { getChainKind } from '@vultisig/core-chain/ChainKind'
import {
  assertKnownAggregatorRouter,
  EnforcedRouterProvider,
} from '@vultisig/core-chain/swap/general/knownAggregatorRouters'

import { KeysignPayload } from '../../types/vultisig/keysign/v1/keysign_message_pb'
import { getKeysignChain } from '../utils/getKeysignChain'
import { getKeysignSwapPayload } from './getKeysignSwapPayload'

const ENFORCED_ROUTER_PROVIDERS = new Set<EnforcedRouterProvider>(['1inch', 'kyber'])

const isEnforcedRouterProvider = (provider: string): provider is EnforcedRouterProvider =>
  ENFORCED_ROUTER_PROVIDERS.has(provider as EnforcedRouterProvider)

/**
 * Signing-time fund-safety guard (round-2 whole-stack audit, P1): re-run the
 * aggregator swap guards on the `KeysignPayload` the co-signer *actually signs*,
 * not just at quote-fetch construction.
 *
 * The quote-construction guards (getOneInchSwapQuote.ts, kyber/api/tx.ts,
 * getJupiterSwapQuote.ts) validate an untrusted aggregator HTTP response before
 * it becomes a `GeneralSwapQuote`. But an MPC co-signer never sees that quote —
 * it receives a `KeysignPayload` (over the relay / QR, see keysign/cosigner.ts)
 * and turns it straight into signable bytes via `getEncodedSigningInputs`. A
 * hand-built payload whose `swapPayload.quote.tx.{to,data}` was never produced by
 * the guarded path would otherwise be blind-signed: the EVM resolver reads
 * `quote.tx.to`/`quote.tx.data` verbatim, and the Solana resolver decodes and
 * signs `quote.tx.data` verbatim. This guard runs at that exact choke point so
 * the bytes the signature covers are the bytes that pass the guard.
 *
 * Enforcement parity with quote-time: only 1inch/kyber have a small, stable,
 * deterministically-deployed router that can be allow-listed (fail-closed). LiFi
 * and SwapKit route through many contracts by design and are unenforceable
 * (log-only, never thrown) at quote-time too — signing-time enforcement inherits
 * the same boundary. See knownAggregatorRouters.ts.
 */
export const assertSafeSwapSigningPayload = async (keysignPayload: KeysignPayload): Promise<void> => {
  const swapPayload = getKeysignSwapPayload(keysignPayload)
  if (!swapPayload || !('general' in swapPayload)) {
    return
  }

  const { general } = swapPayload
  const chain = getKeysignChain(keysignPayload)

  switch (getChainKind(chain)) {
    case 'evm': {
      if (!isEnforcedRouterProvider(general.provider)) {
        return
      }
      const to = general.quote?.tx?.to
      if (!to) {
        return
      }
      assertKnownAggregatorRouter(general.provider, to, chain)

      // The ERC-20 approval that precedes an aggregator swap grants allowance to
      // the router. It is a SEPARATE payload field (erc20ApprovePayload.spender)
      // read verbatim by the approve resolver, so a hand-built payload could keep
      // a benign swap `tx.to` while pointing the approval at an attacker. Bind it
      // to the already-verified router (build.ts sets them equal by construction).
      const spender = keysignPayload.erc20ApprovePayload?.spender
      if (spender && spender.toLowerCase() !== to.toLowerCase()) {
        throw new Error(
          `swap approval spender (${spender}) does not match the verified ${general.provider} router (${to}) on ${chain} — refusing to sign`
        )
      }
      return
    }
    case 'solana': {
      // Jupiter-only: the instruction guard allow-lists the Jupiter v6 router
      // program set. LiFi (and any future Solana aggregator) route through
      // different programs by design, so running this guard on a non-Jupiter
      // Solana swap would false-reject a legitimate route — same unenforceable
      // boundary LiFi has on EVM. Parity with quote-time, where only the Jupiter
      // quote path (getJupiterSwapQuote.ts) runs this guard.
      if (general.provider !== 'jupiter') {
        return
      }
      const data = general.quote?.tx?.data
      const address = keysignPayload.coin?.address
      if (!data || !address) {
        return
      }
      await assertSafeSolanaSwapTransactionBase64(data, new SolanaPublicKey(address))
      return
    }
    default:
      return
  }
}
