# VultiSig CLI - TODO & Implementation Status

This document tracks all TODO items, mocked implementations, and incomplete features found in the VultiSig CLI codebase.

## 🚨 Critical TODOs

### 1. MPC Signing Implementation
**File:** `src/utils/VultiServerClient.ts:77`
```typescript
// TODO: Implement proper MPC ceremony:
// 1. Initialize WASM libraries (DKLS for ECDSA, Schnorr for EdDSA)
// 2. Setup MPC session with VultiServer as peer
// 3. Exchange MPC messages through VultiServer API
// 4. Complete signing ceremony and return signatures
```
**Status:** Critical - Core signing functionality is not implemented
**Impact:** Transaction signing via VultiServer fast mode is not functional

### 2. mDNS Service Discovery
**File:** `src/mpc/MpcMediatorServer.ts:139`
```typescript
// TODO: Re-enable mDNS when dependencies are available
```
**Status:** High - Peer discovery is disabled
**Impact:** Local device discovery for MPC sessions is not functional

## 🔧 Mocked Implementations

### 1. VultiServer Client (Critical)
**File:** `src/utils/VultiServerClient.ts`

**Mocked Methods:**
- `participateInMpcCeremony()` - Line 75: Throws error instead of implementing MPC
- `getPublicKey()` - Lines 108-113: Returns placeholder public keys
- `extractMessagesFromPayload()` - Line 135: Placeholder hex conversion

**Impact:** Fast mode signing is completely non-functional

### 2. MPC Session Implementations
**Files:** 
- `src/mpc/SchnorrKeysignSession.ts`
- `src/mpc/DklsKeysignSession.ts`

**Mocked Features:**
- WASM library initialization (Lines 54 in both files): Disabled for testing
- Signature generation (Lines 138/138): Mock signatures instead of real MPC
- Peer discovery (Lines 167/167): Simulated peer joining after 5 seconds
- Message exchange: Mock message processing instead of real MPC protocol

**Impact:** All MPC signing operations use fake signatures

### 3. MPC Server Manager
**File:** `src/keysign/MpcServerManager.ts`

**Mocked Methods:**
- `startMockMediator()` - Lines 141-169: Mock HTTP endpoints instead of real mediator
- Service discovery: Mock implementation instead of real peer discovery

### 4. Keysign URI Generation
**File:** `src/keysign/KeysignUriGenerator.ts`

**Mocked Features:**
- Payload upload (Line 54): Mock payload ID instead of real relay server upload
- QR code generation: Uses mock payload data


## 🚧 Not Yet Implemented Features

### 1. Message Signing (Ethereum)
**File:** `packages/vultisig-eth-signer/src/VultisigSigner.ts:144-146`
```typescript
// Not implemented yet - requires message signing support in daemon
async signMessage(message: string): Promise<string> {
  throw new Error('Message signing not yet implemented')
}
```

### 2. Package Spec Features
**File:** `packages/package-spec.md:50`
```typescript
// signMessage() - not yet implemented
```

## 🔍 Placeholder Implementations

### 1. Public Key Retrieval
**File:** `src/utils/VultiServerClient.ts:108-113`
- Returns hardcoded placeholder strings instead of real public keys
- No actual vault loading or key extraction

### 2. Message Extraction
**File:** `src/utils/VultiServerClient.ts:135`
- Simple hex conversion instead of proper transaction parsing
- No network-specific message extraction logic

### 3. Session Management
**File:** `src/mpc/MpcMediatorServer.ts:250-290`
- Mock keysign payload structure for QR codes
- Placeholder derivation paths

## ⚠️ Temporarily Disabled Features

### 1. WASM Library Integration
**Files:**
- `src/mpc/SchnorrKeysignSession.ts:6,54`
- `src/mpc/DklsKeysignSession.ts:6,54`

**Status:** Libraries are imported but initialization is disabled
**Reason:** "temporarily disabled for testing"

### 2. mDNS Advertisement
**File:** `src/mpc/MpcMediatorServer.ts:119,140`
- mDNS service advertisement is disabled
- Only console logging instead of actual network advertisement

## 📋 Test-Related Issues

### 1. Package Integration Tests
**File:** `tests/package-integration.test.js:155,173-175`
- Tests expect "not implemented" errors for signing functionality
- Tests are written around known limitations

### 2. Mock Transaction Data
**File:** `tests/test-signing-ui.js`
- Extensive mock transaction structure for UI testing
- No real transaction processing

## 🎯 Implementation Priority

### High Priority (Blocking Core Functionality)
1. **MPC Signing Implementation** - Core feature, completely missing
2. **WASM Library Integration** - Required for real cryptographic operations
3. **VultiServer API Integration** - Fast mode is non-functional

### Medium Priority (Feature Completeness)
1. **mDNS Service Discovery** - Local peer discovery
2. **Message Signing** - Ethereum message signing support
3. **Real Payload Processing** - Network-specific transaction parsing

### Low Priority (Polish & Testing)
1. **Remove Mock Implementations** - Replace with real implementations
2. **Update Tests** - Remove "not implemented" expectations
3. **Error Handling** - Improve error messages for incomplete features

## 📊 Implementation Status Summary

- **✅ Complete:** Vault loading, address derivation, daemon architecture
- **🚧 Partial:** QR code generation, session management, HTTP APIs
- **❌ Missing:** MPC signing, WASM integration, VultiServer communication
- **🔧 Mocked:** All cryptographic operations, peer discovery, signing flow

## 🔗 Related Files

### Core Implementation Files
- `src/utils/VultiServerClient.ts` - Main signing client (heavily mocked)
- `src/mpc/SchnorrKeysignSession.ts` - EdDSA signing (mocked)
- `src/mpc/DklsKeysignSession.ts` - ECDSA signing (mocked)
- `src/mpc/MpcMediatorServer.ts` - MPC coordination (partially mocked)

### Package Files
- `packages/vultisig-eth-signer/src/VultisigSigner.ts` - Ethereum signer
- `packages/vultisig-btc-signer/src/VultisigSigner.ts` - Bitcoin signer  
- `packages/vultisig-sol-signer/src/VultisigSigner.ts` - Solana signer

### Test Files
- `tests/test-signing-ui.js` - Mock signing UI
- `tests/package-integration.test.js` - Package integration tests

---

**Last Updated:** Generated automatically by scanning the codebase
**Total TODOs Found:** 2 explicit TODO comments
**Total Mocked Implementations:** 15+ major mocked features
**Critical Blocking Issues:** 3 (MPC signing, WASM integration, VultiServer API)
