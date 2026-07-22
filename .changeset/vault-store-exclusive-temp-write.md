---
'@vultisig/sdk': patch
---

Write stored vaults through an unpredictable, exclusively-created temp file. The Node file storage used a `Math.random()` temp name and a non-exclusive `writeFile`, so a temp path that could be predicted and pre-created was reused (leaving key shares in the pre-existing file's permissions) or followed as a symlink (redirecting them elsewhere). The temp name now uses `crypto.randomBytes`, the file is created exclusively at mode 0600, and the store directory is created 0700. A pre-existing temp path fails the write closed and is never removed, while a temp file this write did create is removed on any failure. Closing that file is part of the write: a filesystem that defers a write failure to close now fails the save instead of publishing a truncated vault.
