---
'@vultisig/mpc-native': patch
---

Release the Expo SDK 56 alignment that has been sitting on `main` unpublished.

`0.1.4` on npm still declares `expo: ^55.0.0` as its peer and depends on `@expo/config-plugins: ^9.0.0`, while this repo corrected both onto the `56.x` line in #570 and #632. Those landed as dependabot PRs, which do not cut changesets, so every release run since has skipped this package and consumers have kept resolving the stale declarations. In practice that means a consumer on SDK 56 nests its own `@expo/config-plugins@9.1.7` for this package alone, and that nested copy is what runs the prebuild mod injecting the dkls and goschnorr AARs.

No code changes. This publishes the declarations `main` already carries.
