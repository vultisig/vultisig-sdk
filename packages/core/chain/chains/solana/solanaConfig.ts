export const solanaConfig = {
  priorityFeeLimit: Number(100_000), // Compute-unit limit for priority fee
  priorityFeePrice: 1_000_000, // Floor price in micro-lamports per CU

  // Solana charges 5000 lamports per signature. Vultisig sends are
  // single-signer, so this is the per-tx base fee. If a future path
  // emits multi-signer messages this becomes 5000 * N.
  baseFee: 5000,

  // Rent-exempt minimum for a 165-byte SPL token associated account, used
  // when emitting `createAssociatedTokenAccount` alongside an SPL transfer.
  // Constant on mainnet/devnet/testnet — rent rate is hardcoded in the
  // Solana runtime.
  ataRentLamports: 2_039_280,
}
