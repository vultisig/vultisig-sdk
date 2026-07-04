/**
 * Bittensor (TAO) native balance — public read. Wraps the SCALE-storage read in
 * `bittensor.ts` with TAO formatting. Read-only — never signs.
 */
import { assertBittensorAddress, BITTENSOR_BASE_FEE_HUMAN, getBittensorBalance, TAO_DECIMALS } from './bittensor'

function formatTao(rao: bigint): string {
  const divisor = 10n ** BigInt(TAO_DECIMALS)
  const whole = rao / divisor
  const frac = rao % divisor
  if (frac === 0n) return whole.toString()
  return `${whole}.${frac.toString().padStart(TAO_DECIMALS, '0').replace(/0+$/, '')}`
}

export type TaoBalance = {
  chain: 'Bittensor'
  address: string
  freeRao: string
  freeTao: string
  decimals: number
  note: string
}

/**
 * Query the native TAO balance of a Bittensor SS58 address (prefix=42, starts
 * with "5"). Returns the free balance in both RAO (base units) and TAO. Rejects
 * Polkadot/Kusama/etc. addresses before any RPC call (fund-safety).
 */
export async function getTaoBalance(address: string): Promise<TaoBalance> {
  if (!address) throw new Error('No Bittensor address provided.')
  // Gate prefix BEFORE any RPC call — SS58 chains share 32-byte AccountId
  // encoding; a Polkadot/Kusama address would otherwise resolve to the
  // Bittensor account derived from those bytes (fund confusion).
  assertBittensorAddress(address)

  const free = await getBittensorBalance(address)
  return {
    chain: 'Bittensor',
    address,
    freeRao: free.toString(),
    freeTao: formatTao(free),
    decimals: TAO_DECIMALS,
    note: `Network fee for sends: ~${BITTENSOR_BASE_FEE_HUMAN}`,
  }
}
