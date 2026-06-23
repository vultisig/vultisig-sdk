#!/usr/bin/env node
/**
 * Runnable receipt for the sdk.validate normalizers.
 *
 * Exercises the PURE chain-math primitives end to end:
 *   - scale a real base-unit amount to human (the CACAO decimals golden case)
 *   - round-trip it back to base units
 *   - ground a claimed amount with relative tolerance
 *   - compute + validate an EVM gas fee from gasLimit * maxFeePerGas
 *   - validate + normalize a token symbol
 *
 * No vault, no signing, no broadcast, no network. Pure math.
 *
 * Run:  node --import tsx scripts/receipts/validate_normalizers.mjs
 *       (or: yarn workspace @vultisig/sdk dlx tsx ../../scripts/receipts/...)
 *
 * Imports straight from the TS source via tsx so the receipt always reflects
 * the working tree, not a stale dist build.
 */
import {
  amountMatches,
  computeEvmFee,
  decimalsFor,
  feeMatches,
  isValidTokenSymbolFormat,
  normalizeTokenSymbol,
  scaleHumanToRaw,
  scaleRawToHuman,
} from '../../packages/sdk/src/utils/validateNormalizers.ts'

const line = (k, v) => console.log(`${k.padEnd(28)} ${v}`)

console.log('=== sdk.validate normalizers — runnable receipt ===\n')

// 1) Decimals scaling — the CACAO golden drift case (raw=220208030381, dec=10).
const raw = '220208030381'
const cacaoDec = decimalsFor('CACAO')
const human = scaleRawToHuman(raw, cacaoDec)
line('CACAO decimals (registry)', cacaoDec)
line('raw base units', raw)
line('-> human', `${human} CACAO`)

// 2) Inverse round-trip.
const back = scaleHumanToRaw(human, cacaoDec)
line('human -> raw (round-trip)', back.toString())
line('round-trip lossless?', back === BigInt(raw))

// 3) Ground a claimed amount within 1% tolerance, reject a mis-scaled one.
line('claim 22.02 within 1%?', amountMatches('22.02', human, 0.01))
line('claim 0.00022.. (off 1e5)?', amountMatches('0.000220208030381', human, 0.01))

// 4) EVM fee: 21000 gas * 15 gwei.
const gasLimit = 21000n
const maxFeePerGas = 15_000_000_000n
const fee = computeEvmFee(gasLimit, maxFeePerGas)
line('gasLimit * maxFeePerGas fee', `${fee} ETH`)
line('claim 0.000315 within 5%?', feeMatches('0.000315', gasLimit, maxFeePerGas))
line('claim 0.01 (fabricated)?', feeMatches('0.01', gasLimit, maxFeePerGas))

// 5) Token-symbol format + normalization.
const sym = normalizeTokenSymbol('ruji/rune')
line('normalize ruji/rune', `${sym.symbol}  parts=[${sym.parts.join(', ')}]`)

// 6) Symbol SHAPE now mirrors Go symbolCandidateRe (3-10 chars, upper-only
//    base/pair). 2-char tickers (OP/ZK) and digit-led tickers are rejected,
//    exactly like the backend extractor — lowercase still normalizes (case-
//    insensitive via upper-casing before the shape test).
line('USDC valid?', isValidTokenSymbolFormat('USDC'))
line('usdc.e valid (lowercase)?', isValidTokenSymbolFormat('usdc.e'))
line('OP rejected (2-char, was bug)?', !isValidTokenSymbolFormat('OP'))
line('1INCH rejected (digit-led)?', !isValidTokenSymbolFormat('1INCH'))

console.log('\n=== OK — all normalizers produced real results, no signing/broadcast ===')
