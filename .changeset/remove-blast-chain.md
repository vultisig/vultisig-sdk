---
'@vultisig/core-chain': major
'@vultisig/core-mpc': major
'@vultisig/sdk': major
---

Remove Blast chain support. Blast L2 has shut down: blast.io is now a fund-recovery page, L2BEAT archived the chain on 2026-11-10, `https://api.vultisig.com/blast/` returns 404 and `rpc.blast.io` no longer resolves, so balances, sends and swaps on Blast cannot work.

`Chain.Blast` / `EvmChain.Blast` are removed from the chain union, along with the Blast entries in the chain registry, EVM RPC and viem chain tables, fee, gas-limit and priority-fee tables, the OP-stack chain list, the Blast token list, Blockaid, price and Banxa mappings, LI.FI router pin, SwapKit tracker id, native-swap memo table, keysign chain-specific mapping, address derivation, Uniswap and Across tables, and token search.

Saved vaults that still list Blast now load without it. `SecureVault.fromStorage` and `FastVault.fromStorage` copied persisted chain names into the vault unchecked, so a chain the SDK no longer supports (Blast, and Kujira before it) came back and failed on first use. Both now drop chains outside the `Chain` union, the same way the other restore paths already did.

Consumers holding a persisted `Chain.Blast` value must drop it — the symbol no longer type-checks.
