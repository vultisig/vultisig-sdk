/**
 * Runnable receipt for sdk.defi.river — builds an UNSIGNED River Omni-CDP
 * open-trove tx (plus delegate-approval + close-trove) with sample inputs and
 * prints the decoded calldata. NO signing, NO broadcast, NO RPC.
 *
 * Run from packages/sdk:
 *   yarn tsx scripts/receipts/defi_river.mjs
 */
import { decodeFunctionData } from 'viem'

import {
  buildRiverCloseTrove,
  buildRiverDelegateApproval,
  buildRiverOpenTrove,
} from '../../src/tools/defi/river/river.ts'
import {
  RIVER_BORROWER_OPS_ABI,
  RIVER_PERIPHERY_ABI,
} from '../../src/tools/defi/river/abi.ts'
import { RIVER_CHAIN_CONFIG } from '../../src/tools/defi/river/constants.ts'

const log = (...a) => console.log(...a)
const hr = () => log('-'.repeat(72))

const CHAIN = 'Ethereum'
// A WETH market trove-manager (sample). Hints supplied explicitly so the build
// is fully offline (no RPC walk of the sorted-troves list).
const TROVE_MANAGER = '0x1111111111111111111111111111111111111111'
const UPPER_HINT = '0x2222222222222222222222222222222222222222'
const LOWER_HINT = '0x3333333333333333333333333333333333333333'

log('=== sdk.defi.river — UNSIGNED River Omni-CDP build receipt ===')
log(`chain: ${CHAIN}`)
log('system contracts:', JSON.stringify(RIVER_CHAIN_CONFIG[CHAIN], null, 2))
hr()

// 1) Delegate approval (prerequisite)
const approval = buildRiverDelegateApproval({ chain: CHAIN })
const approvalDecoded = decodeFunctionData({ abi: RIVER_BORROWER_OPS_ABI, data: approval.tx.data })
log('1) DELEGATE APPROVAL')
log('   tx:', JSON.stringify(approval.tx))
log('   decoded:', approvalDecoded.functionName, JSON.stringify(approvalDecoded.args.map(String)))
hr()

// 2) Open trove (the headline build) — inject a non-default fee tolerance + tag
const open = await buildRiverOpenTrove({
  chain: CHAIN,
  troveManager: TROVE_MANAGER,
  collateralAmount: 1_000_000_000_000_000_000n, // 1 WETH
  debtAmount: 2_000_000_000_000_000_000_000n, // 2000 satUSD
  upperHint: UPPER_HINT,
  lowerHint: LOWER_HINT,
  affiliate: { maxFeeBps: 250, affiliateTag: 'demo-consumer' },
})
const openDecoded = decodeFunctionData({ abi: RIVER_PERIPHERY_ABI, data: open.tx.data })
log('2) OPEN TROVE')
log('   tx.to:', open.tx.to)
log('   tx.value:', open.tx.value)
log('   tx.chainId:', open.tx.chainId)
log('   tx.data:', open.tx.data)
log('   decoded fn:', openDecoded.functionName)
log('   decoded args:')
log('     troveManager      =', openDecoded.args[0])
log('     maxFeePercentage  =', openDecoded.args[1].toString(), '(wad)')
log('     collAmount        =', openDecoded.args[2].toString())
log('     debtAmount        =', openDecoded.args[3].toString())
log('     upperHint         =', openDecoded.args[4])
log('     lowerHint         =', openDecoded.args[5])
log('   meta:', JSON.stringify(open.meta, null, 2))
hr()

// 2b) Open trove — native collateral (offline): collateralIsNative carries value
const openNative = await buildRiverOpenTrove({
  chain: CHAIN,
  troveManager: TROVE_MANAGER,
  collateralAmount: 1_000_000_000_000_000_000n, // 1 native (ETH)
  debtAmount: 2_000_000_000_000_000_000_000n,
  upperHint: UPPER_HINT,
  lowerHint: LOWER_HINT,
  collateralIsNative: true,
})
log('2b) OPEN TROVE (native collateral, offline)')
log('   tx.value:', openNative.tx.value, '(== collAmount, delivers the collateral)')
log('   meta.nativeCollateral:', openNative.meta.nativeCollateral)
log('   meta.collateralApprovalRequired:', openNative.meta.collateralApprovalRequired)
hr()

// 3) Close trove
const close = buildRiverCloseTrove({ chain: CHAIN, troveManager: TROVE_MANAGER })
const closeDecoded = decodeFunctionData({ abi: RIVER_PERIPHERY_ABI, data: close.tx.data })
log('3) CLOSE TROVE')
log('   tx:', JSON.stringify(close.tx))
log('   decoded:', closeDecoded.functionName, JSON.stringify(closeDecoded.args.map(String)))
log('   satUSD approval required:', close.meta.satUsdApprovalRequired, '-> spender', close.meta.satUsdApprovalSpender)
hr()

// Assertions so the receipt is self-checking
const assert = (cond, msg) => {
  if (!cond) {
    console.error('RECEIPT ASSERTION FAILED:', msg)
    process.exit(1)
  }
}
assert(approval.tx.to === RIVER_CHAIN_CONFIG[CHAIN].app, 'approval targets app')
assert(open.tx.to === RIVER_CHAIN_CONFIG[CHAIN].periphery, 'open targets periphery')
assert(openDecoded.functionName === 'openTrove', 'open encodes openTrove')
assert(openDecoded.args[1].toString() === '25000000000000000', 'maxFee 250bps = 0.025e18')
assert(open.meta.affiliateTag === 'demo-consumer', 'affiliate tag injected (not hardcoded)')
assert(close.tx.data.startsWith('0x'), 'close calldata is hex')
assert(openNative.tx.value === '1000000000000000000', 'native open carries collateral in value')
assert(openNative.meta.collateralApprovalRequired === false, 'native open needs no ERC-20 approval')

log('OK — all River builds produced valid UNSIGNED calldata (no broadcast).')
