---
'@vultisig/sdk': minor
---

Add optional `appId` to push device registration (`registerDevice`). Apps that
share a vault with the regular wallet (e.g. Station, `money.terra.station`) can
now register/unregister under their own bundle id, so the notification service
routes their pushes to the correct app instead of the wallet that shares the
vault. The field is optional and omitted by default, so existing wallet
registrations are unchanged.
