import { assertValidPoolId } from '../../chains/cosmos/thor/lp/pools'
import { assertMemoByteLength } from './limitSwapMemo'

/**
 * THORChain / MayaChain `MsgDeposit` memo action prefixes, mirroring
 * THORNode's memo parser (`x/thorchain/memo`). `SWAP`/`=`/`s` is
 * deliberately excluded: native swaps route through the server-issued memo
 * returned by `getNativeSwapQuote`, never through this generic deposit
 * builder, so a swap-shaped memo arriving here is already out of place.
 */
const THORCHAIN_DEPOSIT_MEMO_PREFIXES = [
  'add',
  'a',
  '+',
  'withdraw',
  'wd',
  '-',
  'donate',
  'd',
  'bond',
  'unbond',
  'leave',
  'migrate',
  'noop',
  'consolidate',
  'name',
  'n',
  '~',
  'trade+',
  'trade-',
  'pool+',
  'pool-',
  'loan+',
  'loan-',
  'secure+',
  'secure-',
] as const

const isPrintableAsciiMemo = (memo: string): boolean => /^[\x21-\x7E](?:[\x20-\x7E]*[\x21-\x7E])?$/.test(memo)

/**
 * Fail closed on a memo that isn't printable ASCII, that doesn't lead with a
 * recognized THORChain/MayaChain deposit action, or that exceeds the same
 * byte budget as the limit-swap memo (`assertMemoByteLength`, 'other' — the
 * source chain for a `MsgDeposit` is always THORChain/MayaChain itself,
 * never a UTXO chain). Unlike `buildLimitSwapMemo`, which constructs its
 * memo from validated structured fields,
 * `prepareThorchainMsgDepositTxFromKeys` accepts a pre-built memo string
 * verbatim — a malformed or garbage memo would otherwise sign a
 * value-bearing MsgDeposit that THORNode either rejects (wasted network fee)
 * or misinterprets (SDK-CORRECTNESS-06). This deliberately validates only
 * the action prefix, basic character safety, and — for the two LP actions
 * whose pool argument the docstring documents (`+:POOL[:PAIRED]`,
 * `-:POOL:BPS[:ASSET]`) — the pool id, not the full per-action argument
 * grammar, so legitimate operator-style memos (BOND with provider/fee args,
 * etc.) still pass.
 */
export const assertValidThorchainDepositMemo = (memo: string): void => {
  if (typeof memo !== 'string' || memo.length === 0) {
    throw new Error('memo must be a non-empty string')
  }
  if (!isPrintableAsciiMemo(memo)) {
    throw new Error('memo must contain printable ASCII characters only, with no leading/trailing whitespace')
  }
  assertMemoByteLength(memo, 'other')

  const segments = memo.split(':')
  const [rawPrefix, pool] = segments
  const prefix = rawPrefix.toLowerCase()
  if (!(THORCHAIN_DEPOSIT_MEMO_PREFIXES as readonly string[]).includes(prefix)) {
    throw new Error(
      `memo action "${rawPrefix}" is not a recognized THORChain/MayaChain deposit memo action ` +
        `(expected one of: ${THORCHAIN_DEPOSIT_MEMO_PREFIXES.join(', ')})`
    )
  }

  const isLpAction =
    prefix === 'add' || prefix === 'a' || prefix === '+' || prefix === 'withdraw' || prefix === 'wd' || prefix === '-'
  if (isLpAction && pool !== undefined) {
    assertValidPoolId(pool)
  }
}
