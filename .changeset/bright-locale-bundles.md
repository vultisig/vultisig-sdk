---
'@vultisig/sdk': patch
---

Move React Native FormatJS polyfills to build-only dependencies so ordinary SDK installs no longer download their locale data. The polyfills remain embedded in the React Native bundle; React Native consumers do not need to add packages.
