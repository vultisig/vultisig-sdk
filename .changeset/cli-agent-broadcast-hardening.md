---
'@vultisig/cli': patch
---

Harden the `agent ask` broadcast dedupe guard per PR review (fund-safety, audit F1/F3/F14):

- **Cross-process TOCTOU:** an atomic reservation (exclusive-create lock keyed by the broadcast fingerprint) is now taken BEFORE signing, so two sibling processes can't both pass the duplicate check and both broadcast. The loser refuses with `DUPLICATE_BROADCAST`; a stale reservation (crashed owner) is stolen after a TTL so retries aren't wedged.
- **ACK_FAILED no longer masks retryable errors:** exit 8 is now gated on an actual still-unacknowledged broadcast (a broadcast whose follow-up report was undelivered when the turn threw), not merely "some non-failed tx exists". A later independent retryable error after an already-acked broadcast keeps its retryable classification.
- **Dedicated exit code for `DUPLICATE_BROADCAST` (9):** no longer shares 4 with generic invalid input, so `$?` alone can branch the fund-safety refusal. Documented in the CLI exit-code taxonomy and `agent ask --help`; the JSON error `code` is unchanged.
- **Journal growth bounded:** `broadcasts.jsonl` is pruned on write (size-gated compaction dropping records strictly outside the dedupe window), so a later sign no longer parses an ever-growing file.
