---
"@vultisig/sdk": patch
"@vultisig/cli": patch
"@vultisig/mcp": patch
---

security: bump transitive deps to fix 5 high-severity advisories

- form-data: 4.0.5 -> 4.0.6 (CRLF injection, GHSA-hmw2-7cc7-3qxx)
- protobufjs: 7.5.8 -> 7.6.4, 8.3.0 -> 8.6.3 (DoS via unbounded Any expansion, GHSA-wcpc-wj8m-hjx6)
- tmp: 0.2.6 -> 0.2.7 (path traversal via type confusion, GHSA-7c78-jf6q-g5cm)
- vite: 8.0.10 -> 8.0.16 (server.fs.deny bypass on Windows, GHSA-fx2h-pf6j-xcff)
- ws: 7.5.10 -> 7.5.11, 8.17.1/8.20.x -> 8.21.0 (memory exhaustion DoS, GHSA-96hv-2xvq-fx4p)

all bumped via yarn resolutions; no direct dep changes.
