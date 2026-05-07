---
'@vultisig/cli': patch
---

CLI agent executor now recognizes the mcp-ts `execute_*` tx_ready envelope shape (`txArgs.tx`) for `execute_send` and `execute_contract_call`. Previously the executor only handled mcp-go's older shapes (`swap_tx` / `send_tx` / `tx`) and silently skipped every mcp-ts payload, leaving local-dev parity broken against production. Multi-leg `execute_swap` envelopes (carrying `approvalTxArgs`) are explicitly rejected for now — multi-leg sequencing is a follow-up.
