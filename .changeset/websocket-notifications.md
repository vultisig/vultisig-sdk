---
"@vultisig/sdk": minor
---

Add WebSocket real-time notification delivery to PushNotificationService

New methods on `sdk.notifications`:
- `connect(options)` — Open WebSocket for real-time signing notifications with auto-reconnect
- `disconnect()` — Close WebSocket and stop reconnect (also called by `sdk.dispose()`)
- `connectionState` — Current connection state (`disconnected` | `connecting` | `connected` | `reconnecting`)
- `onConnectionStateChange(handler)` — Subscribe to connection state changes

Messages are delivered through the existing `onSigningRequest()` callbacks. Auto-reconnects with exponential backoff (1s → 30s cap). Server retains unacked messages for 60s for reliable delivery across reconnections.
