# Vultisig SDK Comprehensive Testing Plan

## Executive Summary

The Vultisig SDK currently has **ZERO test coverage** for ~3,645 lines of production code handling critical cryptographic operations, multi-party computation (MPC), and 30+ blockchain integrations. This document outlines a comprehensive testing strategy to achieve 85% code coverage through a phased implementation approach.

## Current State Analysis

### Codebase Metrics

- **Total Files**: 27 TypeScript files
- **Lines of Code**: ~3,645
- **Test Coverage**: 0%
- **Supported Chains**: 30+ blockchains
- **External Dependencies**: 2 servers (VultiServer, MessageRelay)
- **WASM Modules**: 3 (WalletCore, DKLS, Schnorr)

### Critical Gaps

- No unit tests for core functionality
- No integration tests for vault operations
- No end-to-end tests for user flows
- No chain-specific test fixtures
- No performance benchmarks
- No security testing framework

## Testing Strategy Overview

### Goals

1. **Immediate**: Establish testing infrastructure and achieve 30% coverage
2. **Short-term**: Test core components to reach 50% coverage
3. **Mid-term**: Integration testing for 65% coverage
4. **Long-term**: E2E and advanced testing for 85% coverage
5. **Ongoing**: Maintain and expand test suite with new features

### Principles

- **Test-First Development**: Write tests before new features
- **Chain Coverage**: Every supported blockchain must have fixtures
- **Security Focus**: Cryptographic operations require extensive validation
- **Performance Monitoring**: Track operation timing and resource usage
- **Continuous Integration**: Automated testing on every commit

## Implementation Phases

### Phase Timeline

| Phase   | Duration  | Coverage Target | Focus Area                  |
| ------- | --------- | --------------- | --------------------------- |
| Phase 1 | Week 1-2  | 30%             | Foundation & Infrastructure |
| Phase 2 | Week 3-4  | 50%             | Core Components             |
| Phase 3 | Week 5-6  | 65%             | Integration Testing         |
| Phase 4 | Week 7-8  | 75%             | End-to-End Testing          |
| Phase 5 | Week 9-10 | 85%             | Advanced & Security         |

### Phase 1: Foundation (Week 1-2)

**Objective**: Establish robust testing infrastructure

Key deliverables:

- Testing framework setup (Vitest, coverage tools)
- Chain fixture framework for all 30+ blockchains
- Mock strategies for WASM and servers
- Utility function tests
- CI/CD pipeline configuration

[Detailed implementation in PHASE_1_FOUNDATION.md](PHASE_1_FOUNDATION.md)

### Phase 2: Core Components (Week 3-4)

**Objective**: Test critical SDK components

Key deliverables:

- VultisigSDK class tests
- Vault and VaultManager tests
- ChainManager tests with fixtures
- Service layer tests (Cache, FastSigning)
- Adapter pattern tests

[Detailed implementation in PHASE_2_CORE.md](PHASE_2_CORE.md)

### Phase 3: Integration Testing (Week 5-6)

**Objective**: Validate component interactions (MOCKED - No Real Funds)

Key deliverables:

- Address derivation for ALL 40+ chains with REAL WASM
- Vault import/export integration with encryption
- Component integration (Vault → WASM → Chains)
- Cache behavior validation
- Chain-specific address format validation

**Strategy**: Uses MOCKED vault creation with REAL WASM modules. No production servers, no real funds, no financial risk.

[Detailed implementation in PHASE_3_INTEGRATION.md](PHASE_3_INTEGRATION.md)

### Phase 4: End-to-End Testing (Week 7-8)

**Objective**: Test complete user workflows (PRODUCTION - Real Funds)

🔴 **CRITICAL**: This phase uses **PRODUCTION environment with REAL FUNDS** (small amounts)

Key deliverables:

- Fast vault creation flow with REAL MPC operations
- Transaction signing with REAL signing ceremonies
- REAL transaction broadcasting on mainnet (small amounts $1-5 per chain)
- Email verification flow with production server
- Full import/export cycles with real vault files
- Error recovery scenarios

**Safety**: $50 total budget, manual approval required for all transactions, comprehensive logging and backups.

[Detailed implementation in PHASE_4_E2E.md](PHASE_4_E2E.md)

### Phase 5: Advanced Testing (Week 9-10)

**Objective**: Production readiness

Key deliverables:

- Performance benchmarks
- Security testing suite
- Load testing
- Multi-chain parameterized tests
- Documentation and maintenance guides

[Detailed implementation in PHASE_5_ADVANCED.md](PHASE_5_ADVANCED.md)

## Test Organization Structure

```
packages/sdk/tests/
├── unit/                         # Fast, isolated tests
│   ├── VultisigSDK.test.ts
│   ├── vault/
│   │   ├── Vault.test.ts
│   │   ├── VaultManager.test.ts
│   │   └── services/
│   ├── chains/
│   │   ├── ChainManager.test.ts
│   │   └── per-chain/           # Chain-specific tests
│   │       ├── bitcoin.test.ts
│   │       ├── ethereum.test.ts
│   │       └── [30+ chain tests]
│   ├── server/
│   ├── wasm/
│   └── utils/
├── integration/                  # Component interaction tests
│   ├── vault-lifecycle/
│   ├── address-derivation/
│   ├── server-coordination/
│   └── chain-operations/
├── e2e/                         # Full workflow tests
│   ├── fast-vault-creation/
│   ├── transaction-signing/
│   ├── import-export/
│   └── multi-chain-flows/
├── fixtures/                    # Test data
│   ├── chains/                 # Chain-specific fixtures
│   │   ├── bitcoin/
│   │   ├── ethereum/
│   │   └── [30+ chain directories]
│   ├── vaults/
│   ├── server/
│   └── common/
├── benchmarks/                  # Performance tests
│   ├── vault-operations.bench.ts
│   ├── chain-operations.bench.ts
│   └── wasm-loading.bench.ts
└── helpers/                     # Test utilities
    ├── mock-factories.ts
    ├── chain-helpers.ts
    └── fixture-loaders.ts
```

## Chain-Specific Testing Requirements

### Fixture Requirements per Chain

Each of the 30+ supported blockchains MUST have:

1. **Address Fixtures** (`addresses.json`)
   - Valid addresses with derivation paths
   - Invalid addresses for validation testing
   - Different address formats (legacy, segwit, etc.)

2. **Transaction Fixtures** (`transactions.json`)
   - Unsigned transaction samples
   - Signed transaction samples
   - Message hashes for signing
   - Chain-specific features (memo, data, etc.)

3. **Balance Fixtures** (`balances.json`)
   - Native token balances
   - Token balances (ERC-20, SPL, etc.)
   - Decimal handling examples
   - USD conversion data

4. **RPC Response Fixtures** (`rpc-responses.json`)
   - Balance query responses
   - Gas estimation responses
   - Transaction broadcast responses
   - Error responses

[Complete chain fixture specification in TEST_DATA_SPEC.md](TEST_DATA_SPEC.md)

### Supported Chains (30+)

**Tier 1 Priority (Test First)**

- Bitcoin (BTC) - UTXO model
- Ethereum (ETH) - EVM chain
- Solana (SOL) - EdDSA signatures
- THORChain (THOR) - Cosmos SDK
- Ripple (XRP) - Unique architecture

**Tier 2 Priority**

- Polygon, Binance Smart Chain, Avalanche
- Cosmos, Osmosis, Noble, Kujira, Dydx
- Litecoin, Dogecoin, Bitcoin Cash, Dash

**Tier 3 Priority**

- Arbitrum, Optimism, Base, Blast, zkSync
- Sui, Polkadot, Tron, Near, Ton

## Testing Strategies

### Environment Test Matrix

The SDK supports multiple environments with different capabilities and constraints. Tests should be targeted to environments where the code actually behaves differently.

| Feature                 | Node.js     | Browser        | Electron Main | Electron Renderer | Chrome Extension | React Native    | Test Priority        |
| ----------------------- | ----------- | -------------- | ------------- | ----------------- | ---------------- | --------------- | -------------------- |
| **Vault Creation**      | ✓           | ✓              | ✓             | ✓                 | ✓                | ✓               | LOW (same logic)     |
| **File Import**         | Direct fs   | FileReader API | Direct fs     | IPC to main       | N/A              | react-native-fs | HIGH (different)     |
| **File Export**         | Direct fs   | Download       | Direct fs     | IPC to main       | chrome.downloads | react-native-fs | HIGH (different)     |
| **Crypto Ops**          | Node crypto | Web Crypto     | Node crypto   | Web Crypto        | Web Crypto       | Polyfill        | CRITICAL (different) |
| **Storage**             | File system | IndexedDB      | File system   | IndexedDB         | chrome.storage   | AsyncStorage    | HIGH (different)     |
| **WASM Load**           | Direct      | fetch          | Direct        | fetch             | CSP restricted   | Custom loader   | MEDIUM (mostly same) |
| **Network**             | http/https  | fetch/XHR      | http/https    | fetch/XHR         | fetch (limited)  | fetch           | LOW (same logic)     |
| **Address Derivation**  | ✓           | ✓              | ✓             | ✓                 | ✓                | ✓               | LOW (same logic)     |
| **Transaction Signing** | ✓           | ✓              | ✓             | ✓                 | ✓                | ✓               | LOW (same logic)     |

### Environment Testing Order (Simplest First)

1. **Node.js** (Week 9, Day 1-2)
   - All APIs available, no restrictions
   - Baseline for functionality
   - Direct file system access
   - Native crypto module

2. **Browser** (Week 9, Day 3-4)
   - Standard Web APIs
   - FileReader for imports
   - Web Crypto API
   - IndexedDB storage

3. **Electron Main** (Week 9, Day 5)
   - Same as Node.js
   - Process type detection

4. **Electron Renderer** (Week 9, Day 5)
   - Browser-like with IPC
   - Restricted file access
   - contextBridge usage

5. **React Native** (Week 10, Day 1)
   - Custom APIs
   - AsyncStorage
   - No WASM support
   - Platform differences

6. **Chrome Extension** (Week 10, Day 2)
   - Most restrictive
   - CSP limitations
   - chrome.storage API
   - Manifest V3 constraints

### Mock Levels

#### Level 1: Full Mocks (Unit Tests)

- Mock all external dependencies
- In-memory storage
- Deterministic responses
- Fast execution (<1ms per test)

#### Level 2: Partial Mocks (Integration)

- Real WASM modules
- Mocked network calls
- Real cryptographic operations
- Test fixtures for blockchain data

#### Level 3: Test Environment (E2E)

- Test server endpoints
- Testnet blockchains
- Real vault operations
- Full user workflows

### Key Test Scenarios

#### Vault Operations

- [ ] Create fast vault (2-of-2 with server)
- [ ] Import encrypted vault file
- [ ] Export vault with password
- [ ] Delete vault and cleanup
- [ ] Handle corrupted vault data
- [ ] Verify email flow
- [ ] Session timeout recovery

#### MPC Protocols

- [ ] ECDSA keygen (Bitcoin, Ethereum)
- [ ] EdDSA keygen (Solana)
- [ ] Fast signing coordination
- [ ] Message relay polling
- [ ] Error recovery
- [ ] Session management

#### Chain Operations (Per Chain)

- [ ] Derive correct address format
- [ ] Validate address checksum
- [ ] Query native token balance
- [ ] Query token balances
- [ ] Build valid transactions
- [ ] Sign transactions correctly
- [ ] Handle chain-specific features

#### Performance Requirements

- [ ] Vault creation < 30 seconds
- [ ] Address derivation < 100ms per chain
- [ ] Transaction signing < 10 seconds
- [ ] Import/export < 5 seconds
- [ ] WASM load < 2 seconds
- [ ] Memory usage < 200MB

## CI/CD Integration

### GitHub Actions Workflow

```yaml
name: Test Suite

on:
  push:
    branches: [main, develop]
  pull_request:

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - Test changed files
      - Generate coverage report
      - Upload to Codecov

  integration-tests:
    runs-on: ubuntu-latest
    needs: unit-tests
    steps:
      - Run integration suite
      - Test all chain fixtures
      - Validate WASM loading

  e2e-tests:
    runs-on: ubuntu-latest
    needs: integration-tests
    if: github.ref == 'refs/heads/main'
    steps:
      - Run E2E suite
      - Test with real servers
      - Performance benchmarks
```

### Pre-commit Hooks

```bash
#!/bin/sh
# .husky/pre-commit

# Run unit tests for changed files
npm run test:unit -- --changed

# Validate chain fixtures
npm run validate:fixtures

# Type checking
npm run type-check

# Lint
npm run lint
```

## Success Metrics

### Coverage Goals

- **Unit Tests**: 90% of pure functions
- **Integration Tests**: 80% of component interactions
- **E2E Tests**: 100% of critical user paths
- **Overall Coverage**: 85% minimum

### Performance Benchmarks

| Operation                       | Target | Acceptable | Failed |
| ------------------------------- | ------ | ---------- | ------ |
| Vault Creation                  | <30s   | <45s       | >60s   |
| Address Derivation (all chains) | <3s    | <5s        | >10s   |
| Transaction Signing             | <10s   | <15s       | >30s   |
| Import/Export                   | <5s    | <10s       | >15s   |
| Memory Usage                    | <200MB | <300MB     | >500MB |

### Quality Gates

- No PR merged without tests
- Coverage must not decrease
- All chain fixtures must pass validation
- Performance benchmarks must pass
- Security tests must pass

## Risk Assessment

### High Priority Risks

1. **MPC Protocol Failures**
   - Impact: Complete vault failure
   - Mitigation: Extensive protocol testing, error recovery

2. **Key Material Exposure**
   - Impact: Loss of funds
   - Mitigation: Security testing, encrypted storage

3. **Invalid Signatures**
   - Impact: Transaction failures
   - Mitigation: Chain-specific validation tests

### Medium Priority Risks

1. **Server Unavailability**
   - Impact: Fast vault operations fail
   - Mitigation: Timeout handling, retry logic

2. **Chain RPC Failures**
   - Impact: Balance/transaction issues
   - Mitigation: Fallback providers, caching

3. **Fixture Obsolescence**
   - Impact: False test results
   - Mitigation: Regular fixture updates

## Maintenance Plan

### Daily

- Monitor CI/CD pipeline
- Review test failures
- Update failing tests

### Weekly

- Review coverage reports
- Update chain fixtures
- Performance benchmark review

### Monthly

- Security audit of tests
- Update dependencies
- Review and update test plan

### Quarterly

- Major test refactoring
- New chain integration
- Documentation updates

## Resources Required

### Team

- **Lead Developer**: Test architecture and planning
- **SDK Developers**: Write unit and integration tests
- **QA Engineer**: E2E tests and test data
- **DevOps**: CI/CD pipeline setup

### Tools

- **Testing**: Vitest, Testing Library
- **Coverage**: C8, Codecov
- **Mocking**: MSW, Vitest mocks
- **Performance**: Vitest bench
- **Security**: OWASP tools

### Time Estimate

- **Total Duration**: 10 weeks
- **Developer Hours**: ~400 hours
- **QA Hours**: ~200 hours
- **DevOps Hours**: ~40 hours

## Getting Started

1. **Review** this plan with the team
2. **Start** with [Phase 1: Foundation](PHASE_1_FOUNDATION.md)
3. **Set up** CI/CD pipeline
4. **Create** chain fixtures for Tier 1 chains
5. **Write** first unit tests for utilities
6. **Track** progress with coverage reports

## Appendices

- [Phase 1: Foundation Details](PHASE_1_FOUNDATION.md)
- [Phase 2: Core Components](PHASE_2_CORE.md)
- [Phase 3: Integration Testing](PHASE_3_INTEGRATION.md)
- [Phase 4: End-to-End Testing](PHASE_4_E2E.md)
- [Phase 5: Advanced Testing](PHASE_5_ADVANCED.md)
- [Test Data Specification](TEST_DATA_SPEC.md)

---

_This testing plan is a living document and will be updated as the SDK evolves. Last updated: November 2024_
