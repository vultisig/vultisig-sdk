---
'@vultisig/core-chain': minor
'@vultisig/sdk': minor
---

Add the Kamino Earn transaction pipeline under `chains/solana/kamino/tx`: build the unsigned deposit/withdraw transactions (with the withdraw-everything sentinel refused before a request leaves the device); inject the attribution memo and the compute-budget pair into the built v0 transaction without disturbing address-lookup-table indexes; replace the recent blockhash immediately before keysign; a fail-closed validator that admits only allow-listed programs, matches the exact instruction sequence each operation produces (both withdraw discriminators, the farms unstake pair, exactly one memo carrying exactly the attribution tag), pins every account that decides where money goes against the registry and local ATA/PDA derivations, pins every spend amount, and refuses unexplained writable accounts; and an offline decoder that lets a co-signing device derive an independent claim about what the bytes do — vault identified through the signer's own share account, both withdraw shapes accepted, the farm release bounded by the withdraw itself.
