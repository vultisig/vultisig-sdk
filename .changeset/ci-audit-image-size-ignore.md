---
'@vultisig/sdk': patch
---

Unblock the `quality:audit` CI gate, which was failing repo-wide on 3 newly-published high-severity advisories:

- `nanoid` (via `postcss`, GHSA-2v37-7h3g-55p8): fixed by a resolution bump to `^3.3.17` - a real, safe patch upgrade, no API change.
- `image-size` (via `metro@0.84.4`, GHSA-w3rx-r6r6-pgpr / GHSA-5p2g-fcmc-qvqq): no fix is available yet. The patched line is `>=2.0.3`, but `image-size` has not published past `2.0.2`, and `metro`'s latest release (`0.87.0`) still pins `image-size@^1.0.2` - there is no dependency bump that can close this today. `image-size` is not a direct dependency anywhere in this repo; it is metro's own asset-dimension parser, used only by the RN/Metro dev bundler toolchain, never by SDK/CLI runtime code shipped to consumers. Added the two advisory IDs to `quality:audit`'s `--ignore` list with this changeset as the tracking note - revert once `image-size >= 2.0.3` ships or `metro` moves off the vulnerable range.
