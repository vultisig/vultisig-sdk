---
'@vultisig/sdk': patch
---

Retry temporary HTTP 429 responses when fetching Jupiter quotes or building unsigned swap transactions, with at most two retries after 300 ms and 600 ms. Other failures still surface immediately. Each attempt retains its own 15-second timeout.
