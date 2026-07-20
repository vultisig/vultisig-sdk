import { Buffer } from 'buffer'
import { assertSafeSolanaSwapTransactionBase64 } from '@vultisig/core-chain/chains/solana/assertSafeSolanaSwapInstructions'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import { assertField } from '@vultisig/lib-utils/record/assertField'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { matchRecordUnion } from '@vultisig/lib-utils/matchRecordUnion'
import { PublicKey } from '@solana/web3.js'
import { TW } from '@trustwallet/wallet-core'

import { getBlockchainSpecificValue } from '../../../chainSpecific/KeysignChainSpecific'
import { getKeysignSwapPayload } from '../../../swap/getKeysignSwapPayload'
import { getKeysignChain } from '../../../utils/getKeysignChain'
import { SigningInputsResolver } from '../../resolver'
import { getSolanaSendSigningInput } from './send'

export const getSolanaSigningInputs: SigningInputsResolver<'solana'> = ({ keysignPayload, walletCore }) => {
  const chain = getKeysignChain(keysignPayload)

  const { recentBlockHash } = getBlockchainSpecificValue(keysignPayload.blockchainSpecific, 'solanaSpecific')

  if (keysignPayload.signData.case === 'signSolana') {
    // Handled upstream in getEncodedSigningInputs (sdk#1204): dApp raw
    // transactions are signed over their ORIGINAL message bytes and never
    // routed through TransactionDecoder + SigningInput.rawMessage — the
    // WalletCore re-encode is not byte-identical for v0+ALT transactions
    // and breaks mixed-vault co-signing (ios#4419, android#5223). Reaching
    // this branch means a caller bypassed getEncodedSigningInputs; fail
    // loud instead of silently re-introducing the divergent pre-image.
    throw new Error(
      'signSolana raw transactions are handled in getEncodedSigningInputs — do not resolve them into TW SigningInputs (sdk#1204)'
    )
  }

  const swapPayload = getKeysignSwapPayload(keysignPayload)

  if (swapPayload) {
    return matchRecordUnion(swapPayload, {
      native: () => [getSolanaSendSigningInput({ keysignPayload, walletCore })],
      general: async swapPayload => {
        const tx = shouldBePresent(swapPayload.quote?.tx)
        const { data } = tx

        // sdk#1358 fund-safety: re-run the Jupiter program allow-list + fund-movement guard HERE, on
        // the co-signer signing-input path, not only at quote construction. Every co-signer (e.g.
        // VultiServer in a 2-of-2) independently rebuilds this input from the shared KeysignPayload and
        // signs it verbatim (only recentBlockhash is overwritten below), so a compromised initiator
        // could otherwise slip a drain instruction into swapPayload.quote.tx.data that no co-signer ever
        // validated. This is a PURE gate - it throws (fail-closed, like the Ripple resolver) or no-ops,
        // and never touches the bytes that get signed, so it cannot desync the cross-device pre-signing
        // hash. userWallet is the signing vault's own Solana address (coin.address).
        //
        // JUPITER-SCOPED on purpose: the allow-list (JUPITER_SWAP_ALLOWED_PROGRAM_IDS) is Jupiter's
        // program set, and the only quote-time caller is getJupiterSwapQuote. LiFi and SwapKit also
        // route Solana swaps (lifiSwapEnabledChains / swapKitEnabledChains include Chain.Solana) through
        // Raydium/Orca/executor + fee-transfer instructions that are NOT in that set - guarding those
        // here would fail-closed on a legitimate swap and brick the keysign. Mirrors the EVM arm, which
        // only enforces the providers whose router is actually allow-listed.
        //
        // TRUST OF `provider` (same boundary the EVM arm documents in knownAggregatorRouters.ts): this
        // is the free `provider` STRING on the OneInchSwapPayload proto, part of the attacker-influenceable
        // payload, NOT a trusted oneof discriminant. So an attacker can embed a Jupiter tx in
        // quote.tx.data but relabel `provider` to a non-jupiter value (or omit it -> '') to skip this
        // guard. That is NOT a new bypass: this gate is MONOTONIC (throws or no-ops, never mutates the
        // signed bytes), so skipping it merely degrades to the pre-#1358 state where no Solana
        // signing-path guard ran at all - a payload that was unsignable before is not made signable. What
        // the guard buys is defense against the realistic partial compromise the issue targets: a quote
        // server/MITM that swaps quote.tx.data but leaves an honestly-declared `provider: 'jupiter'`
        // intact. Complete co-signer protection would need a proto change (a distinct oneof case per
        // provider) to key enforcement on the case rather than the string - out of scope, not a regression.
        if (swapPayload.provider === 'jupiter') {
          const userWallet = new PublicKey(assertField(keysignPayload, 'coin').address)
          await assertSafeSolanaSwapTransactionBase64(data, userWallet)
        }

        const decodedData = walletCore.TransactionDecoder.decode(
          getCoinType({
            walletCore,
            chain,
          }),
          Buffer.from(data, 'base64')
        )
        const { transaction } = TW.Solana.Proto.DecodingTransactionOutput.decode(decodedData)

        if (!transaction) {
          throw new Error("Can't decode swap transaction")
        }

        if (transaction.legacy) {
          transaction.legacy.recentBlockhash = recentBlockHash
        } else if (transaction.v0) {
          transaction.v0.recentBlockhash = recentBlockHash
        }

        const signingInput = TW.Solana.Proto.SigningInput.create({
          v0Msg: true,
          recentBlockhash: recentBlockHash,
          rawMessage: transaction,
        })

        return [signingInput]
      },
    })
  }

  return [getSolanaSendSigningInput({ keysignPayload, walletCore })]
}
