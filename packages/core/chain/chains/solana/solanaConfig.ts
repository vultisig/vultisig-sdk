export const solanaConfig = {
  priorityFeeLimit: Number(100_000), // Compute-unit limit for priority fee
  priorityFeePrice: 1_000_000, // Floor price in micro-lamports per CU

  // Solana charges 5000 lamports per signature. Vultisig sends are
  // single-signer, so this is the per-tx base fee. If a future path
  // emits multi-signer messages this becomes 5000 * N.
  baseFee: 5000,

  // Rent-exempt minimum for a 165-byte SPL token associated account, used
  // when emitting `createAssociatedTokenAccount` alongside an SPL transfer.
  //
  // Derivation: (128-byte account header + 165-byte SPL Token data)
  //             × RENT_PER_BYTE_PER_YEAR (3480 lamports)
  //             × 2-year threshold
  //           = 293 × 3480 × 2
  //           = 2,039,280 lamports
  //
  // Constant on mainnet/devnet/testnet today — rent rate is hardcoded in
  // the Solana runtime. If Solana ever bumps RENT_PER_BYTE_PER_YEAR or
  // the 2-year threshold, re-derive from the formula above.
  ataRentLamports: 2_039_280,
}
