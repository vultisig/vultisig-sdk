# @vultisig/mpc-native

## 0.1.3

### Patch Changes

- [#267](https://github.com/vultisig/vultisig-sdk/pull/267) [`91aa66a`](https://github.com/vultisig/vultisig-sdk/commit/91aa66a0c23576546895d0946b486ae37cf1b23d) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - fix(mpc-native): make Android build green and runtime-functional

  The Android side of `@vultisig/mpc-native` was non-functional end-to-end:
  the Kotlin wrapper imported `godkls.Godkls` / `goschnorr.Goschnorr` (a
  gomobile-style API that doesn't exist in the shipped AARs), the
  `godklsJNI`/`goschnorrJNI` SWIG classes had no static `loadLibrary` initializer
  so the underlying `.so` files were never resolved, and AGP 9+ refuses to
  package the prebuilt AARs as `implementation` deps inside an AAR module
  (`bundleDebugAar` fails with "Direct local .aar file dependencies are not
  supported"). The result was that any consumer trying to import this package on
  Android hit a Gradle config failure during build, and even a hand-patched
  build crashed at first JNI call with `UnsatisfiedLinkError` /
  `LIB_SERIALIZATION_ERROR`. This change makes the Android side actually work:
  - **Kotlin wrapper rewritten against the real SWIG bindings.** All
    `Godkls.*`/`Goschnorr.*` calls replaced with the actual
    `com.silencelaboratories.godkls.godkls.dkls_*` /
    `com.silencelaboratories.goschnorr.goschnorr.schnorr_*` static methods.
    Helper closures wrap the `tss_buffer` / `go_slice` / `Handle` lifecycle
    with `try/finally` cleanup; a per-module `dklsHandles` /`schnorrHandles`
    Long→Handle map preserves the existing JS-side handle ID surface. Optional
    inputs (`keyId`, `messageHash`, `rootChainCode`) pass `null` (matching iOS
    Swift) instead of an empty slice, and QC sessions for the no-keyshare /
    old-party path use `Handle().apply { set_0(-1) }` (mirroring iOS
    `Handle(_0: Int32(keyshareHandle ?? -1))`) so the C side branches correctly.
  - **Static `System.loadLibrary` initializer.** A `companion object { init { … } }`
    loads `godkls`, `goschnorr`, `godklsswig`, `goschnorrswig` in dependency
    order so the SWIG `.so` files find their underlying Go libs already in the
    linker namespace. Wrapped in `try/catch` so a failed load surfaces a clean
    error to JS at first call instead of crashing the host app on launch.
  - **Switched local AARs to `compileOnly`.** Direct `implementation files(libs/*.aar)`
    is forbidden by AGP 9+ inside an AAR module. Using `compileOnly` lets the
    Kotlin wrapper still see the SWIG classes for compilation; runtime
    packaging is handled at the consuming **app** module via the new Expo
    config plugin shipped at `app.plugin.js` (so consumers just add
    `@vultisig/mpc-native` to their `app.json` `plugins` array and the AARs
    end up on the final APK's runtime classpath).
  - **Replaced the prebuilt Android AARs.** The AARs in this package were
    shipping a stripped/old `dkls-android` build whose `libgoschnorrswig.so`
    carried an absolute-path `DT_NEEDED` baked from the original build host
    (so `dlopen` of the SWIG lib failed at runtime on real devices), and
    whose `libgoschnorr.so` rejected the FROST keyshare format used by
    Vultisig vaults with `LIB_SERIALIZATION_ERROR` (Solana / Cardano / other
    EdDSA chains couldn't sign). Replaced with the production-grade builds
    shipped by the `vultisig/vultisig-android` app at `app/libs/`, which have
    no absolute-path issue and accept the keyshare format end-to-end.

## 0.1.2

### Patch Changes

- [#257](https://github.com/vultisig/vultisig-sdk/pull/257) [`665cf03`](https://github.com/vultisig/vultisig-sdk/commit/665cf037951df40dc35068463c4ddd299cec20dd) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - fix: bump expo peer dep range to ^55.0.0 — previous ^51.0.0 was stale and forced consumers onto `npm install --legacy-peer-deps`

- Updated dependencies [[`665cf03`](https://github.com/vultisig/vultisig-sdk/commit/665cf037951df40dc35068463c4ddd299cec20dd)]:
  - @vultisig/mpc-types@0.1.2

## 0.1.1

### Patch Changes

- [#241](https://github.com/vultisig/vultisig-sdk/pull/241) [`0775049`](https://github.com/vultisig/vultisig-sdk/commit/07750496b7af1ece840501b8d884087e048c2b2c) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Fix npm publish failing with HTTP 415 by dereferencing symlinks in `ios/Frameworks` during prepack (registries disallow symlinks in tarballs).
