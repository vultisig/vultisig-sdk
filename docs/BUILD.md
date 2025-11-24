# Vultisig SDK Build Guide

Complete build process for the Vultisig SDK and CLI.

## Prerequisites

- Node.js 18+ (with WebAssembly support)
- Yarn 4.7.0 (as specified in package.json)
- Minimum 8GB RAM for builds (16GB recommended for SDK builds)

## Build Order

**CRITICAL**: Always build in this order to ensure dependencies are correctly compiled:

### 1. Build the SDK (Multiple Targets)

The SDK has **three separate build outputs**:

#### a) Standard Builds (Browser + Node.js CommonJS)

```bash
cd src
yarn build
```

This creates:

- `dist/index.esm.js` - ES Module (for browsers)
- `dist/index.js` - CommonJS (standard Node.js)
- `dist/index.umd.js` - UMD (universal)
- `dist/index.d.ts` - TypeScript declarations

#### b) Node.js-Specific Build (Required for CLI)

```bash
cd src
node --max-old-space-size=8192 ../node_modules/.bin/rollup -c rollup.node.config.js
```

**THIS IS CRITICAL**: The CLI uses `dist/index.node.cjs` which is **only** created by the Node.js-specific build.

This creates:

- `dist/index.node.cjs` - Node.js-optimized CommonJS build

**Why separate builds?**

- The Node.js build is optimized for server-side execution
- Different handling of native modules and dependencies
- CLI launcher specifically requires `index.node.cjs`

#### Complete SDK Build Command

```bash
cd src

# Standard builds
yarn build

# Node.js build for CLI
node --max-old-space-size=8192 ../node_modules/.bin/rollup -c rollup.node.config.js
```

### 2. Build the CLI

```bash
cd clients/cli
yarn build
```

This compiles TypeScript to JavaScript in `dist/` directory.

### 3. Verify Builds

Check that all required files exist:

```bash
# SDK standard builds
ls -lh src/dist/index.esm.js
ls -lh src/dist/index.js
ls -lh src/dist/index.d.ts

# SDK Node.js build (CRITICAL for CLI)
ls -lh src/dist/index.node.cjs

# CLI build
ls -lh clients/cli/dist/cli.js
```

## Common Build Issues

### Issue: CLI shows stale SDK behavior

**Symptom**: CLI doesn't reflect recent SDK changes

**Solution**: You forgot to run the Node.js-specific build!

```bash
cd src
node --max-old-space-size=8192 ../node_modules/.bin/rollup -c rollup.node.config.js
```

Check the timestamp:

```bash
ls -lh src/dist/index.node.cjs
```

It should be recent (just built).

### Issue: Out of memory during build

**Symptom**: "JavaScript heap out of memory"

**Solution**: Increase Node.js memory:

```bash
node --max-old-space-size=16384 ../node_modules/.bin/rollup -c rollup.config.js
```

### Issue: WASM files not found

**Symptom**: "WASM file not found" errors

**Solution**: WASM files should be in:

- `lib/dkls/vs_wasm_bg.wasm`
- `lib/schnorr/vs_schnorr_wasm_bg.wasm`
- `node_modules/@trustwallet/wallet-core/dist/lib/wallet-core.wasm`

Run `yarn install` if any are missing.

## Development Workflow

For active development:

1. Make changes to SDK source files in `src/`
2. Rebuild SDK (both standard AND Node.js builds)
3. Rebuild CLI if CLI code changed
4. Test with CLI or examples

```bash
# Full rebuild cycle
cd src && yarn build && node --max-old-space-size=8192 ../node_modules/.bin/rollup -c rollup.node.config.js
cd ../clients/cli && yarn build
```

## Production Build

For production releases:

```bash
# From project root
yarn install

# Build SDK (all targets)
cd src
yarn build
node --max-old-space-size=16384 ../node_modules/.bin/rollup -c rollup.node.config.js

# Build CLI
cd ../clients/cli
yarn build

# Verify all builds
ls -lh ../src/dist/index.*.js
ls -lh dist/cli.js
```

## Build Scripts

The `clients/cli/scripts/build-final.sh` script automates the complete build process, but you should understand the individual steps above for troubleshooting.

## Memory Requirements

- Standard SDK build: 8GB RAM minimum
- Node.js SDK build: 8GB RAM minimum
- CLI build: 2GB RAM minimum
- Recommended: 16GB RAM for comfortable development

## Clean Build

To start fresh:

```bash
# Clean SDK
cd src
rm -rf dist node_modules
yarn install
yarn build
node --max-old-space-size=8192 ../node_modules/.bin/rollup -c rollup.node.config.js

# Clean CLI
cd ../clients/cli
rm -rf dist node_modules
yarn install
yarn build
```
