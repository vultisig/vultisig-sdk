# Storage Integration Test Plan

**Date:** 2025-11-14
**Status:** Draft
**Purpose:** Comprehensive test plan for StorageManager integration throughout the Vultisig SDK

## Executive Summary

This document outlines a comprehensive test plan for the storage integration in the Vultisig SDK. All existing tests pass (652 tests), but we need specific tests for storage persistence, cross-session data recovery, and storage backend compatibility.

## Background

### What Was Integrated

**Phase 1: Core Data Persistence**
- [AddressBookManager.ts](../../../packages/sdk/src/AddressBookManager.ts:21-31) - Persists address book entries via `init()`, `addAddressBookEntry()`, `removeAddressBookEntry()`, `updateAddressBookEntry()`
- [Vultisig.ts](../../../packages/sdk/src/Vultisig.ts:111-131) - Persists SDK configuration (currency, chains, active chain) via `loadConfigFromStorage()`, `setDefaultCurrency()`, `setDefaultChains()`, `setActiveChain()`

**Phase 2: Vault Persistence**
- [VaultManager.ts](../../../packages/sdk/src/VaultManager.ts:55-75) - Persists vault summaries and active vault ID via `init()`, storage of summaries at `vault:summary:{vaultId}`
- [Vault.ts](../../../packages/sdk/src/vault/Vault.ts:131-161) - Persists per-vault preferences (currency, chains, tokens) via `loadPreferences()`, `savePreferences()`

**Phase 3: Storage Utilities**
- [Vultisig.ts](../../../packages/sdk/src/Vultisig.ts:651-685) - Added `getStorageInfo()` and `clearAllData()` methods
- Quota monitoring (warns at >80% usage)

### Storage Schema

```typescript
// SDK Configuration
'config:defaultCurrency' → string
'config:defaultChains' → Chain[]

// Address Book
'addressBook:saved' → AddressBookEntry[]
'addressBook:vaults' → AddressBookEntry[]

// Vault Data
'vault:summary:{vaultId}' → Summary
'vault:preferences:{vaultId}' → {currency, chains, tokens}

// Active State
'activeVaultId' → string
'activeChain' → Chain
```

### Storage Backends

1. **MemoryStorage** - In-memory Map, no persistence (testing/temporary)
2. **BrowserStorage** - IndexedDB → localStorage → memory fallback chain
3. **NodeStorage** - Filesystem-based (~/.vultisig or Electron userData)
4. **ChromeStorage** - chrome.storage.local API (extensions)

### Breaking Changes

All preference/config setters became async:
- `setDefaultCurrency()`, `setDefaultChains()`, `setCurrency()`, `setChains()`
- `addToken()`, `removeToken()`, `removeChain()`

## Current Test Coverage

### Existing Tests

✅ **MemoryStorage** ([tests/unit/runtime/storage/MemoryStorage.test.ts](../../../packages/sdk/tests/unit/runtime/storage/MemoryStorage.test.ts))
- Comprehensive coverage: basic ops, data types, edge cases, isolation
- 40+ test cases covering all VaultStorage interface methods
- Tests: get/set/remove/list/clear, usage estimation, metadata tracking

✅ **Vultisig.test.ts** ([tests/unit/Vultisig.test.ts](../../../packages/sdk/tests/unit/Vultisig.test.ts:380-403))
- Basic storage integration (accepts custom storage)
- Does NOT test persistence or cross-session recovery

✅ **VaultManager.test.ts** ([tests/unit/vault/VaultManager.test.ts](../../../packages/sdk/tests/unit/vault/VaultManager.test.ts))
- Vault lifecycle operations (create, import, delete)
- Uses MemoryStorage for isolation
- Does NOT test storage persistence across instances

✅ **Vault.test.ts** ([tests/unit/vault/Vault.test.ts](../../../packages/sdk/tests/unit/vault/Vault.test.ts))
- Vault operations (address derivation, signing, token/chain management)
- Does NOT test preference persistence

### Coverage Gaps

❌ **No tests for:**
1. Storage persistence across SDK restart
2. BrowserStorage, NodeStorage, ChromeStorage implementations
3. AddressBookManager storage integration
4. Vultisig configuration persistence
5. VaultManager summary persistence
6. Vault preferences persistence
7. Storage quota monitoring and warnings
8. clearAllData() functionality
9. Cross-session data recovery
10. Storage error handling and graceful degradation

## Test Plan

### 1. Storage Backend Tests (Unit Tests)

**Location:** `packages/sdk/tests/unit/runtime/storage/`

#### 1.1 BrowserStorage Tests
**File:** `BrowserStorage.test.ts`

```typescript
describe('BrowserStorage', () => {
  describe('IndexedDB Mode', () => {
    - Should initialize with IndexedDB
    - Should store and retrieve values via IndexedDB
    - Should handle quota exceeded with fallback to localStorage
    - Should estimate usage via navigator.storage.estimate()
    - Should report quota via navigator.storage.estimate()
  })

  describe('localStorage Mode', () => {
    - Should fallback to localStorage when IndexedDB unavailable
    - Should store and retrieve values via localStorage
    - Should handle quota exceeded with fallback to memory
    - Should estimate quota as 10MB
  })

  describe('Memory Mode', () => {
    - Should fallback to memory when all storage unavailable
    - Should warn about non-persistence
  })

  describe('Fallback Chain', () => {
    - Should try IndexedDB → localStorage → memory in order
    - Should handle private browsing mode
    - Should handle storage disabled scenarios
  })
})
```

**Priority:** HIGH
**Recommendation:** Unit test (mock IndexedDB/localStorage APIs)

---

#### 1.2 NodeStorage Tests
**File:** `NodeStorage.test.ts`

```typescript
describe('NodeStorage', () => {
  describe('Filesystem Operations', () => {
    - Should create storage directory if not exists
    - Should store data as JSON files
    - Should use atomic writes (temp file + rename)
    - Should set file permissions to 0600
    - Should sanitize keys to prevent directory traversal
  })

  describe('Path Detection', () => {
    - Should use ~/.vultisig by default
    - Should detect Electron environment
    - Should use userData directory in Electron
    - Should accept custom basePath
  })

  describe('Error Handling', () => {
    - Should throw StorageError on permission denied
    - Should throw QuotaExceeded on disk full (ENOSPC)
    - Should handle corrupted JSON files
  })

  describe('Metadata', () => {
    - Should track file creation and modification times
    - Should calculate accurate storage usage
  })
})
```

**Priority:** HIGH
**Recommendation:** Integration test (use temp directories)

---

#### 1.3 ChromeStorage Tests
**File:** `ChromeStorage.test.ts`

```typescript
describe('ChromeStorage', () => {
  describe('Chrome API Integration', () => {
    - Should detect chrome.storage.local availability
    - Should throw error when API unavailable
    - Should store and retrieve via chrome.storage.local
    - Should handle quota exceeded errors
  })

  describe('Quota Management', () => {
    - Should report correct quota (QUOTA_BYTES)
    - Should detect unlimitedStorage permission
    - Should calculate usage via getBytesInUse()
  })

  describe('Change Listeners', () => {
    - Should register onChanged listener
    - Should receive changes from other contexts
    - Should cleanup listener on unsubscribe
  })

  describe('Error Handling', () => {
    - Should wrap chrome API errors in StorageError
    - Should handle quota exceeded gracefully
  })
})
```

**Priority:** MEDIUM
**Recommendation:** Unit test (mock chrome.storage API)

---

### 2. Component Storage Integration Tests (Integration Tests)

**Location:** `packages/sdk/tests/integration/storage-integration/`

#### 2.1 AddressBookManager Persistence
**File:** `AddressBookManager-persistence.test.ts`

```typescript
describe('AddressBookManager Storage Integration', () => {
  describe('Data Persistence', () => {
    - Should load saved entries on init()
    - Should persist entries when adding
    - Should persist entries when removing
    - Should persist entries when updating
    - Should clear entries from storage on clear()
  })

  describe('Cross-Session Recovery', () => {
    - Should restore saved entries after manager restart
    - Should restore vault entries after manager restart
    - Should preserve entry metadata (dateAdded)
  })

  describe('Storage Keys', () => {
    - Should use 'addressBook:saved' key
    - Should use 'addressBook:vaults' key
  })

  describe('Error Handling', () => {
    - Should handle missing storage keys gracefully
    - Should handle corrupted storage data
    - Should continue on storage write errors
  })
})
```

**Priority:** HIGH
**Recommendation:** Integration test (test with real storage backends)

---

#### 2.2 Vultisig Configuration Persistence
**File:** `Vultisig-persistence.test.ts`

```typescript
describe('Vultisig Configuration Persistence', () => {
  describe('SDK Restart Scenarios', () => {
    - Should restore defaultCurrency after restart
    - Should restore defaultChains after restart
    - Should restore activeChain after restart
  })

  describe('Configuration Changes', () => {
    - Should persist when calling setDefaultCurrency()
    - Should persist when calling setDefaultChains()
    - Should persist when calling setActiveChain()
  })

  describe('Storage Keys', () => {
    - Should use 'config:defaultCurrency' key
    - Should use 'config:defaultChains' key
    - Should use 'activeChain' key
  })

  describe('First Launch', () => {
    - Should use defaults when no stored config
    - Should not override defaults on first init
  })

  describe('Storage Info & Quota', () => {
    - Should return accurate storage usage via getStorageInfo()
    - Should calculate percentage correctly
    - Should warn when >80% full
    - Should handle missing quota gracefully
  })

  describe('Clear All Data', () => {
    - Should remove all keys via clearAllData()
    - Should emit dataCleared event
    - Should leave no residual data
  })
})
```

**Priority:** HIGH
**Recommendation:** Integration test

---

#### 2.3 VaultManager Persistence
**File:** `VaultManager-persistence.test.ts`

```typescript
describe('VaultManager Storage Integration', () => {
  describe('Vault Summary Persistence', () => {
    - Should persist vault summary on create
    - Should persist vault summary on import
    - Should remove summary on delete
    - Should load summaries on init()
  })

  describe('Active Vault Persistence', () => {
    - Should persist activeVaultId when setting active vault
    - Should restore last active vault on init()
    - Should clear activeVaultId on vault deletion
  })

  describe('Cross-Session Recovery', () => {
    - Should restore vault summaries after manager restart
    - Should not auto-load vaults (must import .vult file)
    - Should restore active vault ID
  })

  describe('Storage Keys', () => {
    - Should use 'vault:summary:{vaultId}' pattern
    - Should use 'activeVaultId' for active vault
  })

  describe('Clear Vaults', () => {
    - Should remove all vault:summary:* keys
    - Should remove all vault:preferences:* keys
    - Should remove activeVaultId key
  })

  describe('Multiple Vaults', () => {
    - Should persist multiple vault summaries independently
    - Should handle vault ID collisions
    - Should maintain referential integrity
  })
})
```

**Priority:** HIGH
**Recommendation:** Integration test

---

#### 2.4 Vault Preferences Persistence
**File:** `Vault-persistence.test.ts`

```typescript
describe('Vault Preferences Persistence', () => {
  describe('Preference Persistence', () => {
    - Should persist currency via setCurrency()
    - Should persist chains via setChains()
    - Should persist chains via addChain()
    - Should persist chains via removeChain()
    - Should persist tokens via addToken()
    - Should persist tokens via removeToken()
  })

  describe('Preference Loading', () => {
    - Should load preferences via loadPreferences()
    - Should restore currency after reload
    - Should restore chains after reload
    - Should restore tokens after reload
  })

  describe('Cross-Session Recovery', () => {
    - Should restore all preferences after vault restart
    - Should handle missing preferences gracefully (use defaults)
  })

  describe('Storage Keys', () => {
    - Should use 'vault:preferences:{vaultId}' pattern
    - Should store all preferences in single object
  })

  describe('Per-Vault Isolation', () => {
    - Should store preferences per vault independently
    - Should not share preferences between vaults
  })
})
```

**Priority:** HIGH
**Recommendation:** Integration test

---

### 3. Cross-Platform Storage Tests (Integration Tests)

**Location:** `packages/sdk/tests/integration/storage-backends/`

#### 3.1 Storage Backend Compatibility
**File:** `backend-compatibility.test.ts`

```typescript
describe('Storage Backend Compatibility', () => {
  describe('MemoryStorage', () => {
    - Should work with all SDK components
    - Should not persist across restarts (expected)
  })

  describe('BrowserStorage', () => {
    - Should work with all SDK components
    - Should persist data across restarts
    - Should handle IndexedDB → localStorage fallback
  })

  describe('NodeStorage', () => {
    - Should work with all SDK components
    - Should persist data to filesystem
    - Should handle custom base paths
  })

  describe('ChromeStorage', () => {
    - Should work with all SDK components
    - Should persist data via chrome.storage.local
    - Should handle quota limits
  })

  describe('Cross-Backend Data Migration', () => {
    - Should export data from one backend
    - Should import data to another backend
    - Should maintain data integrity
  })
})
```

**Priority:** MEDIUM
**Recommendation:** Integration test with conditional execution (skip if environment unavailable)

---

### 4. Error Handling & Edge Cases (Integration Tests)

**Location:** `packages/sdk/tests/integration/storage-edge-cases/`

#### 4.1 Storage Failure Scenarios
**File:** `storage-failures.test.ts`

```typescript
describe('Storage Failure Scenarios', () => {
  describe('Storage Unavailable', () => {
    - Should fallback gracefully when storage unavailable
    - Should not crash app on storage errors
    - Should continue with in-memory data
  })

  describe('Quota Exceeded', () => {
    - Should handle quota exceeded during write
    - Should trigger fallback chain (IndexedDB → localStorage → memory)
    - Should emit warning to console
  })

  describe('Corrupted Data', () => {
    - Should handle corrupted JSON in storage
    - Should skip corrupted entries and continue
    - Should log errors without crashing
  })

  describe('Permission Denied', () => {
    - Should handle permission denied errors
    - Should fallback to memory storage
    - Should warn user appropriately
  })
})
```

**Priority:** HIGH
**Recommendation:** Integration test with mocked failure scenarios

---

#### 4.2 Edge Cases
**File:** `storage-edge-cases.test.ts`

```typescript
describe('Storage Edge Cases', () => {
  describe('Concurrent Operations', () => {
    - Should handle concurrent writes to same key
    - Should handle race conditions in SDK restart
    - Should maintain data consistency
  })

  describe('Large Data Sets', () => {
    - Should handle large vault summaries
    - Should handle many address book entries
    - Should respect storage quotas
  })

  describe('Special Characters', () => {
    - Should handle special characters in vault names
    - Should handle Unicode in address book entries
    - Should sanitize keys properly
  })

  describe('Version Compatibility', () => {
    - Should handle STORAGE_VERSION updates
    - Should migrate old data format
    - Should maintain backwards compatibility
  })

  describe('Multiple SDK Instances', () => {
    - Should handle multiple Vultisig instances
    - Should maintain data isolation
    - Should prevent race conditions
  })
})
```

**Priority:** MEDIUM
**Recommendation:** Integration test

---

### 5. E2E User Workflows (E2E Tests)

**Location:** `packages/sdk/tests/e2e/storage-workflows/`

#### 5.1 Complete User Workflows
**File:** `user-workflows.test.ts`

```typescript
describe('Storage User Workflows', () => {
  describe('Fresh Install', () => {
    - User installs app
    - User creates vault
    - User closes app
    - User reopens app
    - Vault should still be available
  })

  describe('Multi-Vault Management', () => {
    - User creates multiple vaults
    - User switches between vaults
    - User deletes a vault
    - User reopens app
    - Remaining vaults should persist
  })

  describe('Address Book Usage', () => {
    - User adds address book entries
    - User closes app
    - User reopens app
    - Address book should persist
  })

  describe('Configuration Changes', () => {
    - User changes default currency
    - User changes default chains
    - User closes app
    - User reopens app
    - Configuration should persist
  })

  describe('Storage Quota Monitoring', () => {
    - User creates many vaults
    - Storage usage increases
    - User receives warning at 80%
    - User clears old data
    - Storage usage decreases
  })
})
```

**Priority:** MEDIUM
**Recommendation:** E2E test with real storage backends

---

## Test Implementation Strategy

### Phase 1: Storage Backend Tests (Week 1)
1. Implement BrowserStorage tests
2. Implement NodeStorage tests
3. Implement ChromeStorage tests
4. Ensure all backends pass VaultStorage contract

**Success Criteria:**
- All 4 storage backends have comprehensive unit/integration tests
- All backends pass same interface tests
- Coverage > 90% for storage implementations

---

### Phase 2: Component Integration Tests (Week 2)
1. Implement AddressBookManager persistence tests
2. Implement Vultisig configuration persistence tests
3. Implement VaultManager persistence tests
4. Implement Vault preferences persistence tests

**Success Criteria:**
- All components correctly persist and restore data
- Cross-session recovery works for all components
- All async setters persist data correctly

---

### Phase 3: Error Handling & Edge Cases (Week 3)
1. Implement storage failure scenario tests
2. Implement edge case tests
3. Test cross-backend compatibility
4. Test quota monitoring and warnings

**Success Criteria:**
- Storage failures are handled gracefully
- App doesn't crash on storage errors
- Edge cases are covered
- Quota monitoring works correctly

---

### Phase 4: E2E User Workflows (Week 4)
1. Implement complete user workflow tests
2. Test in real browser environment
3. Test in Node.js environment
4. Test in Chrome extension environment

**Success Criteria:**
- All user workflows work end-to-end
- Data persists across app restarts
- Storage integration feels seamless

---

## Test Execution Matrix

| Test Suite | Environment | Backend | Priority |
|------------|-------------|---------|----------|
| MemoryStorage | Node/Browser | Memory | ✅ Complete |
| BrowserStorage | Browser | IndexedDB/localStorage | HIGH |
| NodeStorage | Node/Electron | Filesystem | HIGH |
| ChromeStorage | Chrome Extension | chrome.storage | MEDIUM |
| AddressBookManager | All | All | HIGH |
| Vultisig Config | All | All | HIGH |
| VaultManager | All | All | HIGH |
| Vault Preferences | All | All | HIGH |
| Error Handling | All | All | HIGH |
| Edge Cases | All | All | MEDIUM |
| User Workflows | Browser/Node | Browser/Node | MEDIUM |

---

## Identified Gaps & Recommendations

### Critical Gaps
1. ❌ **No tests for BrowserStorage, NodeStorage, ChromeStorage**
   - **Impact:** Cannot verify storage backends work correctly
   - **Recommendation:** HIGH priority - implement in Phase 1

2. ❌ **No cross-session persistence tests**
   - **Impact:** Cannot verify data survives SDK restart
   - **Recommendation:** HIGH priority - implement in Phase 2

3. ❌ **No storage error handling tests**
   - **Impact:** Cannot verify graceful degradation
   - **Recommendation:** HIGH priority - implement in Phase 3

### Medium Priority Gaps
4. ❌ **No quota monitoring tests**
   - **Impact:** Cannot verify warnings work correctly
   - **Recommendation:** MEDIUM priority - implement in Phase 3

5. ❌ **No cross-backend compatibility tests**
   - **Impact:** Cannot verify data portability
   - **Recommendation:** MEDIUM priority - implement in Phase 3

6. ❌ **No E2E workflow tests**
   - **Impact:** Cannot verify complete user experience
   - **Recommendation:** MEDIUM priority - implement in Phase 4

### Low Priority Gaps
7. ❌ **No storage migration tests**
   - **Impact:** Future storage version upgrades may break
   - **Recommendation:** LOW priority - implement before v2.0

---

## Test Coverage Goals

| Component | Current | Target | Delta |
|-----------|---------|--------|-------|
| StorageManager | 60% | 95% | +35% |
| BrowserStorage | 0% | 90% | +90% |
| NodeStorage | 0% | 90% | +90% |
| ChromeStorage | 0% | 85% | +85% |
| AddressBookManager | 40% | 95% | +55% |
| Vultisig | 65% | 95% | +30% |
| VaultManager | 80% | 95% | +15% |
| Vault | 85% | 95% | +10% |
| **Overall Storage** | **45%** | **92%** | **+47%** |

---

## Success Metrics

### Quantitative Metrics
- Total test count: +120 tests (current: 652 → target: 772)
- Storage test coverage: 45% → 92%
- Test execution time: < 5 minutes (with real backends)
- Flakiness rate: < 1%

### Qualitative Metrics
- All storage backends verified working
- Cross-session recovery proven reliable
- Error handling proven graceful
- User workflows tested end-to-end
- Documentation complete and accurate

---

## Open Questions

1. **Q:** Should we test with real IndexedDB or mock it?
   **A:** Both - unit tests mock, integration tests use real IndexedDB

2. **Q:** How to test filesystem storage in CI?
   **A:** Use temp directories and cleanup after tests

3. **Q:** Should we test storage quota limits?
   **A:** Yes - mock quota exceeded scenarios for unit tests

4. **Q:** Should we test migration from old storage format?
   **A:** Yes - LOW priority, implement before v2.0

5. **Q:** Should we support importing old data without storage?
   **A:** Out of scope - storage is now required

---

## Next Steps

1. ✅ Review this test plan with team
2. ⏳ Prioritize test implementation schedule
3. ⏳ Assign ownership for each test suite
4. ⏳ Begin Phase 1: Storage Backend Tests
5. ⏳ Set up CI pipeline for new tests
6. ⏳ Update documentation with test examples

---

## Appendix

### A. Test File Structure

```
packages/sdk/tests/
├── unit/
│   ├── vitest.config.ts           # Unit test configuration
│   ├── vitest.setup.ts            # Unit test setup
│   ├── mocks/
│   │   └── server-mocks.ts        # Unit test mocks
│   └── runtime/
│       └── storage/
│           ├── MemoryStorage.test.ts (✅ Complete)
│           ├── BrowserStorage.test.ts (⏳ TODO)
│           ├── NodeStorage.test.ts (⏳ TODO)
│           └── ChromeStorage.test.ts (⏳ TODO)
├── runtime/
│   ├── vitest.config.ts           # Runtime test configuration
│   ├── mocks/
│   │   └── browser-apis.ts        # Browser API mocks
│   └── helpers/
│       └── storage-test-utils.ts  # Storage test utilities
├── integration/
│   ├── vitest.config.ts           # Integration test configuration
│   ├── mocks/
│   │   └── server-mocks.ts        # Integration test mocks
│   ├── helpers/
│   │   └── signing-helpers.ts     # Signing test helpers
│   ├── storage-integration/
│   │   ├── AddressBookManager-persistence.test.ts (⏳ TODO)
│   │   ├── Vultisig-persistence.test.ts (⏳ TODO)
│   │   ├── VaultManager-persistence.test.ts (⏳ TODO)
│   │   └── Vault-persistence.test.ts (⏳ TODO)
│   ├── storage-backends/
│   │   └── backend-compatibility.test.ts (⏳ TODO)
│   └── storage-edge-cases/
│       ├── storage-failures.test.ts (⏳ TODO)
│       └── storage-edge-cases.test.ts (⏳ TODO)
└── e2e/
    ├── vitest.config.ts           # E2E test configuration
    ├── vitest.setup.ts            # E2E test setup
    ├── helpers/
    │   ├── test-vault.ts          # E2E test vault helper
    │   └── signing-helpers.ts     # E2E signing helpers
    └── storage-workflows/
        └── user-workflows.test.ts (⏳ TODO)
```

### B. Storage Interface Contract

All storage backends must implement:

```typescript
interface VaultStorage {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
  list(): Promise<string[]>
  clear(): Promise<void>
  getUsage?(): Promise<number>
  getQuota?(): Promise<number | undefined>
}
```

### C. Test Naming Conventions

- Unit tests: `ComponentName.test.ts`
- Integration tests: `ComponentName-behavior.test.ts`
- E2E tests: `workflow-name.test.ts`

### D. Test Utilities Needed

1. **Test Storage Factory**
   ```typescript
   function createTestStorage(type: 'memory' | 'browser' | 'node' | 'chrome'): VaultStorage
   ```

2. **Storage Assertion Helpers**
   ```typescript
   async function expectStoredValue(storage, key, expected)
   async function expectStorageKeys(storage, expected)
   async function expectStorageEmpty(storage)
   ```

3. **Cross-Session Test Helper**
   ```typescript
   async function testPersistence(setup, verify)
   ```

---

**Document Version:** 1.0
**Last Updated:** 2025-11-14
**Author:** Claude (AI Assistant)
**Reviewers:** TBD
