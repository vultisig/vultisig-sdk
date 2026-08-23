---
'@vultisig/sdk': patch
'@vultisig/cli': patch
---

Export `waitForRelayPeerCommittee` from the root and React Native SDK surfaces so headless secure-join coordinators can reuse the canonical relay committee poller without deep-importing internal service paths.
