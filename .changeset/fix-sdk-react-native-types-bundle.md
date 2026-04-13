---
"@vultisig/sdk": patch
---

fix: emit dedicated `dist/index.react-native.d.ts` from the react-native platform entry, and wire the `exports` field to resolve it under TypeScript's `react-native` custom condition — downstream consumers can now `import { keysign } from '@vultisig/sdk'` under Metro/Expo without hand-written module augmentations
