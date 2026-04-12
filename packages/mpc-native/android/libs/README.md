# Android MPC Native Libraries

Pre-built Android `.aar` files containing Rust MPC libraries (DKLS + Schnorr) with JNI wrappers.

| File | Size | Contents |
|------|------|----------|
| `dkls-release.aar` | 1.5MB | DKLS23 threshold ECDSA signing |
| `goschnorr-release.aar` | 1.5MB | Multi-party Schnorr signing |

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

These files are tracked via Git LFS in git. The Release workflow does **not** run `git lfs fetch` on the publish job (avoids LFS bandwidth blocking npm). Instead, `scripts/prepare-mpc-native-aars.mjs` keeps real `.aar` (ZIP) files on disk: if the checkout still has LFS pointers, CI downloads the same filenames from a GitHub Release. Set repo Actions variable `MPC_NATIVE_AARS_DOWNLOAD_TAG` to that release tag (assets must be named `dkls-release.aar` and `goschnorr-release.aar`). **Update that tag** whenever you change the binaries in git, or CI may ship an older pair from the release. Alternatively, migrate off LFS by committing the binaries and removing the `filter=lfs` line in the repo root `.gitattributes` for this path.

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
