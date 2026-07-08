---
"@vultisig/sdk": patch
---

Fix `getCosmosFeeAmount` (canonical cosmos gas resolver, used by the CLI/browser/electron keysign pipeline) to query Osmosis's own EIP-1559 dynamic base-fee endpoint (`/osmosis/txfees/v1beta1/cur_eip_base_fee`) as an additional floor. Previously this resolver only queried the generic `/cosmos/base/node/v1beta1/config` node config for every ibc-enabled chain, which does not track Osmosis's protocol-level dynamic fee and can be clamped away by the anomaly guard during a genuine base-fee spike — leading to a broadcast rejection (sdk error code 13, "insufficient fees"). This mirrors a fix already live in vultiagent-app.
