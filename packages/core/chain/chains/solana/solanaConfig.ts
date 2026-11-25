export const solanaConfig = {
  priorityFeeLimit: Number(100_000), // Compute-unit limit for priority fee
  priorityFeePrice: 1_000_000, // Floor price in micro-lamports per CU

  // Solana charges 5000 lamports per signature. Vultisig sends are
  // single-signer, so this is the per-tx base fee. If a future path
  // emits multi-signer messages this becomes 5000 * N.
  baseFee: 5000,

  // Fallback rent-exempt minimum for a 165-byte SPL token account, used only
  // when the live read in `getSolanaTokenAccountRent` (./tokenAccountRent)
  // fails. Fees and quotes use the live value.
  //
  // (128-byte account header + 165-byte SPL Token data) × 6,960 lamports per
  // byte = 293 × 6,960 = 2,039,280, the rate before SIMD-0437. SIMD-0437 only
  // lowers that rate (the live `getMinimumBalanceForRentExemption(165)` read
  // 1,488,440 in November 2026) and its SIMD-0438 fallback restores it at
  // most, so this stays an upper bound on the live value.
  ataRentLamports: 2_039_280,

  // Rent-exempt minimum for a data-less wallet (system) account. The runtime
  // rejects a transaction that leaves the sender holding anything between
  // zero and this floor.
  //
  // 128-byte account header × 6,960 lamports per byte = 890,880, the rate
  // before SIMD-0437. SIMD-0437 only lowers that rate (the live
  // `getMinimumBalanceForRentExemption(0)` read 650,240 in October 2026) and
  // its SIMD-0438 fallback restores it at most, so this stays an upper bound
  // on the live value.
  walletRentExemptLamports: 890_880,
}
