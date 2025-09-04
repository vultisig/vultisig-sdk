# VaultManager.add() Implementation Plan

## Overview
Implement `VaultManager.add()` and `VaultManager.isEncrypted()` methods to support importing .vult vault files into the SDK.

## Architecture Alignment
- **VAULTPLAN.md**: Static class methods for vault lifecycle management
- **Clean API**: Simple `add(file, password?)` interface
- **Global Settings**: Automatically apply VaultManager's default chains and currency
- **Error Handling**: Structured error messages with proper types

## File Format Support
### .vult File Structure
```
.vult file (base64 encoded)
├── VaultContainer (protobuf)
│   ├── version: uint64
│   ├── is_encrypted: bool
│   └── vault: string (base64 or AES-256-GCM encrypted)
│       └── Vault (protobuf)
│           ├── name, public_keys, signers, created_at, etc.
```

## Required Methods

### 1. `VaultManager.add(file: File, password?: string): Promise<Vault>`
- **Input**: File object + optional password
- **Output**: Vault instance with global settings applied
- **Process**:
  1. Validate file type (.vult)
  2. Parse VaultContainer protobuf
  3. Handle encryption/decryption
  4. Parse inner Vault protobuf
  5. Apply global settings (chains, currency)
  6. Store in VaultManager registry
  7. Return normalized Vault instance

### 2. `VaultManager.isEncrypted(file: File): Promise<boolean>`
- **Input**: File object
- **Output**: Boolean indicating if password is required
- **Process**:
  1. Parse VaultContainer protobuf
  2. Return `is_encrypted` field value

## Core Dependencies

### From @core packages:
```typescript
import { vaultContainerFromString } from '@core/ui/vault/import/utils/vaultContainerFromString'
import { fromCommVault } from '@core/mpc/types/utils/commVault'
import { encryptVaultKeyShares, decryptVaultKeyShares } from '@core/ui/passcodeEncryption/core/vaultKeyShares'
import { VaultSchema } from '@core/mpc/types/vultisig/vault/v1/vault_pb'
```

### From @lib packages:
```typescript
import { decryptWithAesGcm } from '@lib/utils/encryption/aesGcm/decryptWithAesGcm'
import { fromBase64 } from '@lib/utils/fromBase64'
import { fromBinary } from '@bufbuild/protobuf'
import { readFileAsArrayBuffer } from '@lib/utils/file/readFileAsArrayBuffer'
```

## Implementation Steps

### Phase 1: Core Import Logic
1. **File Reading**: Convert File to ArrayBuffer
2. **Container Parsing**: Decode base64 → VaultContainer protobuf
3. **Encryption Check**: Read `is_encrypted` flag
4. **Data Extraction**: Handle encrypted vs unencrypted vault data
5. **Vault Parsing**: Decode base64 → Vault protobuf → Vault object

### Phase 2: Vault Normalization
1. **Global Settings**: Apply VaultManager's defaultChains and defaultCurrency
2. **Field Normalization**: Ensure consistent field names and types
3. **Backup Status**: Set `isBackedUp: true` for imported vaults
4. **Validation**: Basic vault structure validation

### Phase 3: Storage & Registry
1. **Vault Registry**: Add to VaultManager's internal vault storage
2. **Active Vault**: Set as active if no other vaults exist
3. **ID Generation**: Generate unique vault identifier
4. **Metadata**: Store import timestamp and source

### Phase 4: Error Handling
1. **Invalid File Format**: "Unsupported file format. Expected .vult file"
2. **Wrong Password**: "Invalid password for encrypted vault"
3. **Corrupted Data**: "Vault file appears to be corrupted"
4. **Missing Password**: "Password required for encrypted vault"

## Type Definitions

### Input Types
```typescript
type AddVaultInput = {
  file: File
  password?: string
}

type IsEncryptedInput = {
  file: File
}
```

### Output Types
```typescript
type AddVaultOutput = Vault // From @core/ui/vault/Vault

type IsEncryptedOutput = boolean
```

### Error Types
```typescript
enum VaultImportError {
  INVALID_FILE_FORMAT = 'INVALID_FILE_FORMAT',
  PASSWORD_REQUIRED = 'PASSWORD_REQUIRED',
  INVALID_PASSWORD = 'INVALID_PASSWORD',
  CORRUPTED_DATA = 'CORRUPTED_DATA',
  UNSUPPORTED_FORMAT = 'UNSUPPORTED_FORMAT'
}

class VaultImportError extends Error {
  constructor(
    public code: VaultImportError,
    message: string,
    public originalError?: Error
  ) {
    super(message)
    this.name = 'VaultImportError'
  }
}
```

## Global Settings Application

### Default Chains
- If vault has no chains, apply `VaultManager.getDefaultChains()`
- Merge with existing chains (no duplicates)
- Derive addresses for new chains

### Default Currency
- Set vault currency to `VaultManager.getDefaultCurrency()`
- Apply to all balance calculations

## Security Considerations

### Encryption Handling
- **AES-256-GCM**: Standard encryption with authentication
- **Password Derivation**: SHA256(password) for key derivation
- **Secure Wipe**: Clear sensitive data from memory after use

### Validation
- **File Size Limits**: Prevent memory exhaustion attacks
- **Protobuf Validation**: Ensure valid protobuf structure
- **Key Validation**: Verify public key formats and lengths

## Testing Strategy

### Test Cases
1. **Unencrypted Vault**: Import without password
2. **Encrypted Vault**: Import with correct password
3. **Wrong Password**: Handle invalid password gracefully
4. **Missing Password**: Require password for encrypted files
5. **Corrupted File**: Handle malformed data
6. **Unsupported Format**: Reject non-.vult files

### Test Data
- Use existing test vaults in `src/tests/vaults/`
- Create encrypted and unencrypted variants
- Test with various file sizes and complexities

### Integration Tests
- Verify vault appears in registry after import
- Test global settings application
- Validate address derivation for imported vaults
- Test vault switching functionality

## Performance Considerations

### Memory Management
- **Streaming**: Process large files without full memory load
- **Cleanup**: Clear intermediate buffers after use
- **Limits**: Maximum file size validation

### Processing Speed
- **Caching**: Cache parsed containers for repeated operations
- **Async Processing**: Non-blocking file operations
- **Progress Callbacks**: Optional progress reporting for large files

## Browser Compatibility

### File API Support
- **FileReader**: Convert File to ArrayBuffer
- **Blob**: Handle large file chunks
- **URL.createObjectURL**: Memory-efficient file processing

### Web Workers (Future)
- **Heavy Processing**: Move protobuf parsing to web workers
- **Main Thread**: Keep UI responsive during import
- **Progress Updates**: Real-time import progress

## Implementation Checklist

### Core Functionality
- [ ] VaultManager.add() static method
- [ ] VaultManager.isEncrypted() static method
- [ ] File format validation (.vult extension)
- [ ] VaultContainer protobuf parsing
- [ ] Encryption detection and handling
- [ ] AES-256-GCM decryption
- [ ] Inner Vault protobuf parsing
- [ ] Vault object normalization
- [ ] Global settings application

### Error Handling
- [ ] Invalid file format detection
- [ ] Password validation
- [ ] Corrupted data handling
- [ ] Memory limit enforcement
- [ ] Graceful error recovery

### Storage & Registry
- [ ] Vault storage in registry
- [ ] Active vault management
- [ ] Vault ID generation
- [ ] Import metadata tracking

### Testing
- [ ] Unit tests for all methods
- [ ] Integration tests with test vaults
- [ ] Error case testing
- [ ] Browser compatibility testing
- [ ] Performance benchmarking

## Dependencies & Imports

### Core Imports
```typescript
// Vault processing
import { vaultContainerFromString } from '@core/ui/vault/import/utils/vaultContainerFromString'
import { fromCommVault } from '@core/mpc/types/utils/commVault'
import { VaultSchema } from '@core/mpc/types/vultisig/vault/v1/vault_pb'

// Encryption
import { decryptWithAesGcm } from '@lib/utils/encryption/aesGcm/decryptWithAesGcm'
import { encryptVaultKeyShares, decryptVaultKeyShares } from '@core/ui/passcodeEncryption/core/vaultKeyShares'

// Utilities
import { fromBase64 } from '@lib/utils/fromBase64'
import { fromBinary } from '@bufbuild/protobuf'
import { readFileAsArrayBuffer } from '@lib/utils/file/readFileAsArrayBuffer'
import { pipe } from '@lib/utils/pipe'
```

### Type Imports
```typescript
import type { Vault } from '@core/ui/vault/Vault'
import type { VaultContainer } from '@core/mpc/types/vultisig/vault/v1/vault_container_pb'
```

## Next Steps

1. **Phase 1**: Implement basic file parsing and VaultContainer handling
2. **Phase 2**: Add encryption/decryption support
3. **Phase 3**: Implement vault normalization and global settings
4. **Phase 4**: Add error handling and validation
5. **Phase 5**: Integrate with VaultManager registry
6. **Phase 6**: Comprehensive testing and documentation

This plan provides a solid foundation for implementing vault import functionality that aligns with the existing Vultisig SDK architecture and maintains compatibility with the current vault format specifications.
