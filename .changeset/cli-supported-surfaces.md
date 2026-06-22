---
'@vultisig/cli': minor
---

Advertise `supported_surfaces: ["balance_summary"]` to the agent backend and
render the `data-balance_summary` card as a terminal table instead of triggering
the backend's legacy "echo card_payload JSON verbatim" path. Adds a defensive
fallback that pretty-renders a balance card envelope if it ever arrives embedded
in message content (older backend). Cards surface in the TUI (table), pipe mode
(`balance_summary` NDJSON event), and `agent ask` (`cards` field / rendered
table). Card string fields (token symbol, chain, address, amounts) are stripped
of terminal control bytes at the parse boundary so attacker-influenced on-chain
metadata or a legacy-echoed payload can't inject ANSI/OSC escape sequences into
the rendered balances table.
