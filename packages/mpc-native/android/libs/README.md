# Android MPC Native Libraries

Pre-built Android `.aar` files containing Rust MPC libraries (DKLS + Schnorr) with JNI wrappers.

These files are **committed as normal Git blobs** (not Git LFS) so CI and clones do not depend on GitHub LFS bandwidth. They are kept in sync with the main **[vultisig-android](https://github.com/vultisig/vultisig-android)** app: from the repo root run `bash scripts/sync-mpc-native-aars-from-android.sh` (expects a sibling `../android` checkout, or set `ANDROID_APP_LIBS` to `app/libs`).

| File | Size (approx.) | Contents |
|------|----------------|----------|
| `dkls-release.aar` | ~9MB | DKLS23 threshold ECDSA signing (multi-ABI; larger than a fully stripped build) |
| `goschnorr-release.aar` | ~2MB | Multi-party Schnorr signing |

Each `.aar` bundles `.so` files for `arm64-v8a`, `x86_64`, and `armeabi-v7a`, plus SWIG JNI wrappers and a small buffer utility.

## Source Repos

- **[vultisig/dkls23-rs](https://github.com/vultisig/dkls23-rs)** (private) -- Rust source for `libgodkls.so` and `libgoschnorr.so`
- **[vultisig/dkls-android](https://github.com/vultisig/dkls-android)** -- SWIG JNI wrappers + Gradle packaging into `.aar`

## Build Pipeline

```
dkls23-rs (Rust)
  cargo ndk --> libgodkls.so + libgoschnorr.so (per arch)
      |
dkls-android (SWIG + CMake + Gradle)
  copy .so into libs/ --> ./gradlew assembleRelease
      |
dkls-release.aar + goschnorr-release.aar
      |
vultisig-sdk/packages/mpc-native/android/libs/
```

## Prerequisites

- Rust toolchain with Android targets
- [cargo-ndk](https://github.com/nickelpack/cargo-ndk): `cargo install cargo-ndk`
- Android NDK (set `ANDROID_NDK_HOME`)
- SWIG (`brew install swig` on macOS)
- CMake 3.22+

## Build Commands

### 1. Build optimized .so files

In the `dkls23-rs` repo:

```bash
# Add Android targets
rustup target add aarch64-linux-android x86_64-linux-android armv7-linux-androideabi
```

Ensure `Cargo.toml` has these release profile flags:

```toml
[profile.release]
lto = true
strip = "symbols"
opt-level = "z"
```

Build both libraries:

```bash
export ANDROID_NDK_HOME=~/Library/Android/sdk/ndk/<version>

cargo ndk -P 21 -t arm64-v8a -t x86_64 -t armeabi-v7a build -p go-dkls --release
cargo ndk -P 21 -t arm64-v8a -t x86_64 -t armeabi-v7a build -p go-schnorr --release
```

Output `.so` files are in `target/<triple>/release/`.

### 2. Package into .aar

In the `dkls-android` repo:

```bash
# Copy .so files into the correct locations
# For DKLS:
cp target/aarch64-linux-android/release/libgodkls.so dkls/src/main/cpp/libs/arm64-v8a/
cp target/x86_64-linux-android/release/libgodkls.so  dkls/src/main/cpp/libs/x86_64/
cp target/armv7-linux-androideabi/release/libgodkls.so dkls/src/main/cpp/libs/armeabi-v7a/

# For Schnorr:
cp target/aarch64-linux-android/release/libgoschnorr.so goschnorr/src/main/cpp/libs/arm64-v8a/
cp target/x86_64-linux-android/release/libgoschnorr.so  goschnorr/src/main/cpp/libs/x86_64/
cp target/armv7-linux-androideabi/release/libgoschnorr.so goschnorr/src/main/cpp/libs/armeabi-v7a/

# Build .aar files
./gradlew :dkls:assembleRelease :goschnorr:assembleRelease
```

Output `.aar` files are in `<module>/build/outputs/aar/`.

### 3. Copy into vultisig-sdk

```bash
cp dkls/build/outputs/aar/dkls-release.aar \
   <sdk>/packages/mpc-native/android/libs/dkls-release.aar

cp goschnorr/build/outputs/aar/goschnorr-release.aar \
   <sdk>/packages/mpc-native/android/libs/goschnorr-release.aar
```

The Release workflow runs `scripts/prepare-mpc-native-aars.mjs` before `npm publish`: it checks that these files are real ZIP archives. If a checkout ever contains Git LFS pointers again, CI can instead download assets from a GitHub Release (set repo variable `MPC_NATIVE_AARS_DOWNLOAD_TAG`, or env `MPC_NATIVE_AARS_BASE_URL`).

## Verification

Check that `.so` files are stripped:

```bash
# Extract the .aar (it's a zip)
unzip dkls-release.aar -d /tmp/dkls-check

# Should show "stripped"
file /tmp/dkls-check/jni/arm64-v8a/libgodkls.so

# Verify exported symbols match between native lib and SWIG wrapper
nm -D /tmp/dkls-check/jni/arm64-v8a/libgodkls.so | grep " T " | awk '{print $3}' | sort > /tmp/exported.txt
nm -D /tmp/dkls-check/jni/arm64-v8a/libgodklsswig.so | grep " U " | grep "dkls_\|tss_buffer" | awk '{print $2}' | sort > /tmp/needed.txt

# Should produce no output (all needed symbols are exported)
comm -23 /tmp/needed.txt /tmp/exported.txt
```

## Notes

- The HD session functions (`dkls_hd_*`, `dkls_keygen_setupmsg_new_with_rank`, `dkls_qc_setupmsg_from_key_id`) were removed from the SWIG interface as they are unused by the React Native SDK. If needed in the future, rebuild from a `dkls23-rs` branch that includes them and restore the declarations in `dkls-android/dkls/src/main/cpp/go-dkls.h`.
- The C FFI interface (exported symbol names and signatures) must not change between rebuilds -- always verify with `nm -D` before replacing.
