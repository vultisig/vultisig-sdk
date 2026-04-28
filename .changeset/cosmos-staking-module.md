---
'@vultisig/sdk': minor
'@vultisig/cli': minor
---

feat: cosmos-sdk staking module - generic Delegate/Undelegate/BeginRedelegate/WithdrawDelegatorReward + LCD queries

Adds the cosmos-sdk staking + distribution module to the SDK, generic across every ibcEnabled cosmos chain we support (Cosmos Hub, Osmosis, Kujira, Terra, TerraClassic, Akash, Noble, Dydx).

**Signing primitives** (`@vultisig/sdk` -> `chains.cosmos.buildCosmosStakingTx`):
- `MsgDelegate`, `MsgUndelegate`, `MsgBeginRedelegate`, `MsgWithdrawDelegatorReward`
- Hand-rolled RN-safe protobuf (no cosmjs runtime dep) mirroring the existing `buildCosmosWasmExecuteTx` pattern
- Multi-msg batch txs supported (e.g. claim rewards from many validators in one tx)
- Byte-for-byte round-trip verified against `cosmjs-types` canonical decoder

**LCD query helpers** (`@vultisig/sdk` top-level + `@vultisig/core-chain/chains/cosmos/staking/lcdQueries`):
- `getCosmosDelegations(chain, address)` -> per-validator balance + shares
- `getCosmosUnbondingDelegations(chain, address)` -> pending unbondings with completion time
- `getCosmosDelegatorRewards(chain, address)` -> per-validator rewards + total
- `getCosmosVestingAccount(chain, address)` -> Periodic / Continuous / Delayed detection (returns null otherwise)

ship-once, unlock-many: adding a future cosmos chain is a config-only change.

34 new unit tests including 4 real cosmoshub fixtures captured from `cosmos1a8l3srqyk5krvzhkt7cyzy52yxcght6322w2qy`.
