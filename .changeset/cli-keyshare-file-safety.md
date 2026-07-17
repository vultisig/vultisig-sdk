---
'@vultisig/cli': patch
'@vultisig/sdk': patch
---

Tighten the handling of files that carry key shares:

- Write exported `.vult` files owner-only (0600) instead of with the default umask
  (0644, world-readable), matching the SDK's own vault store. The export is written to
  a fresh temp file and renamed over the target, so the shares are never on disk at a
  looser mode — `writeFile`'s `mode` only applies when it creates the file, so writing
  straight to a pre-existing path would have left the shares world-readable for a window.
- Stop `rename` rejecting vault names the ecosystem itself creates (e.g. the `#` in
  "Vultisig Cluster #1"), which made rename a one-way door. The alphanumeric allowlist
  is replaced with a denylist of what is genuinely unsafe for the export filename the
  name is interpolated into: path separators and control characters.
