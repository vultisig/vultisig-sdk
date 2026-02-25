---
"@vultisig/sdk": minor
---

Add push notification support for multi-party signing coordination

New `PushNotificationService` accessible via `sdk.notifications` enables the full vault notification flow:
- **Register**: Register devices (iOS/Android/Web) to receive push notifications for a vault
- **Notify**: Notify other vault members with keysign session data when initiating signing
- **Receive**: Handle incoming push notifications with typed callbacks and payload parsing

Platform-agnostic design — SDK handles server communication while consumers wire their platform's push infrastructure (APNs, FCM, Web Push).
