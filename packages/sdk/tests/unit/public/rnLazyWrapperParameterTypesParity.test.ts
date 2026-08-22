import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const sdkRoot = resolve(__dirname, '../../..')
const reactNativeEntry = readFileSync(resolve(sdkRoot, 'src/platforms/react-native/index.ts'), 'utf8')

// sdk#1935: the RN entry's lazy `await import(...)` wrappers (getMaxSendAmountFromKeys,
// prepareSendTxFromKeys, balancePolkadot, fiatToAmount, parseKeygenQR, etc.) were declared
// `(...args: unknown[])`. TypeScript's own inference resolves the return type correctly from
// the dynamic-import call in the body, but the parameter list stayed erased, and
// rollup-plugin-dts preserved that erasure verbatim in dist/index.react-native.d.ts — RN
// consumers lost autocomplete/parameter contracts on these helpers. Fixed by typing the rest
// param as `Parameters<typeof import('module')['export']>` (a type-only query: zero runtime
// import, same lazy-loading rationale the wrappers already relied on).
describe('react-native lazy wrapper parameter-type parity (sdk#1935)', () => {
  it('keeps every lazy `await import(...)` RN wrapper typed with a real parameter signature, not unknown[]', () => {
    expect(reactNativeEntry).not.toMatch(/\.\.\.args:\s*unknown\[\]/)
  })

  it.each([
    'getMaxSendAmountFromKeys',
    'prepareContractCallTxFromKeys',
    'prepareJettonTransferTxFromKeys',
    'prepareSendTxFromKeys',
    'prepareSignAminoTxFromKeys',
    'prepareSignDirectTxFromKeys',
    'prepareSwapTxFromKeys',
    'prepareTrc20TransferFromKeys',
    'buildSplTransfer',
    'prepareUtxoConsolidateTxFromKeys',
    'balancePolkadot',
    'getPolkadotNativeBalance',
    'getPolkadotAssetBalance',
    'fiatToAmount',
    'parseKeygenQR',
  ])("types %s's rest param from Parameters<typeof import(...)[...]>, not unknown[]", name => {
    const wrapperSource = reactNativeEntry.slice(reactNativeEntry.indexOf(`function ${name}(`))
    const signature = wrapperSource.slice(0, wrapperSource.indexOf(') {') + 1)

    expect(signature).toMatch(/\.\.\.args: Parameters<\(?typeof import\(/)
    expect(signature).not.toContain('unknown[]')
  })
})
