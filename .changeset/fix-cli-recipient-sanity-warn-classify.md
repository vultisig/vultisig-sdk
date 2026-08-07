---
'@vultisig/cli': patch
---

`vsig send` now warns (instead of hard-refusing) on a self-send recipient, and the warning is fixed up in two places:

- The recipient-sanity refusal for null/burn/malformed-EVM addresses now classifies as `INVALID_ADDRESS`/exit 4 instead of falling through to `UNKNOWN`/exit 7, so a scripted caller can branch a fund-safety refusal from a generic crash.
- The self-send warning is threaded into the JSON result (`warning` field) in addition to the table-mode `warn()` output, so `--output json`/CI callers don't silently lose the warning (JSON mode implies silent mode, which made `warn()` a no-op).
