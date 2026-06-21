---
"@vultisig/lib-utils": patch
"@vultisig/sdk": patch
---

Make `getUrlBaseDomain` resolve the registrable (eTLD+1) domain using the Public Suffix List instead of taking the last two hostname labels. Sites under multi-label public suffixes (`*.vercel.app`, `*.github.io`, `*.pages.dev`, `*.web.app`, `*.co.uk`, …) now resolve to distinct domains, so a connection authorized for one site is no longer treated as authorized for an unrelated sibling under the same suffix.
