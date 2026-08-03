---
'@vultisig/cli': patch
---

Render `yield_opportunities` and `polymarket_markets` agent surfaces as prose instead of leaking raw `{"surface":...}` JSON into the terminal. The CLI only advertised `balance_summary`/`turn_outcome` in `supported_surfaces`, so any other surface fell back to the backend's legacy verbatim-echo path. Adds parsers, prose renderers, and a legacy-echo fallback for both surfaces, mirroring the existing `balance_summary` handling, and wires them through the TUI, pipe mode, and `agent ask`.
