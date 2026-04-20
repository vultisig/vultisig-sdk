/**
 * Minimal UTXO shape required by lovelace coin selection. Matches
 * `CardanoExtendedUtxo` but is structurally typed so callers can pass any
 * row with an `amount: bigint`.
 */
export type CardanoCoinSelectionUtxo = { amount: bigint }

export type SelectCardanoUtxosByLovelaceInput<T extends CardanoCoinSelectionUtxo> = {
  utxos: readonly T[]
  targetLovelace: bigint
}

/**
 * Greedy largest-first coin selection by lovelace.
 *
 * Used by CIP-30 `getUtxos(amount)` to return a minimal covering set. The
 * wallet is free to return a superset (the spec explicitly allows it), but
 * picking largest-first keeps the returned set small, which reduces the
 * CBOR payload size and the dApp's downstream selection work.
 *
 * Returns `null` when even the full set is insufficient to meet the target.
 */
export const selectCardanoUtxosByLovelace = <T extends CardanoCoinSelectionUtxo>({
  utxos,
  targetLovelace,
}: SelectCardanoUtxosByLovelaceInput<T>): T[] | null => {
  const sorted = [...utxos].sort((a, b) =>
    a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0
  )
  let total = 0n
  const picked: T[] = []
  for (const u of sorted) {
    if (total >= targetLovelace) break
    picked.push(u)
    total += u.amount
  }
  return total >= targetLovelace ? picked : null
}
