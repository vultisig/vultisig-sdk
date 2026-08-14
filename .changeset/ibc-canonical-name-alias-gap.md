---
'@vultisig/sdk': patch
---

Fix `prepareIbcTransfer` falsely rejecting valid IBC destinations (Celestia, Juno, Axelar, Neutron, Injective) passed as Vultisig canonical chain names — the `VULTISIG_NAME_TO_CHAIN_ID` alias table had fallen behind the `IBC_CHANNEL_DEST` route table. Also added a regression test that structurally enforces the two tables stay in sync going forward.
