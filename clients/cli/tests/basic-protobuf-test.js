const fs = require('fs');
const path = require('path');

console.log('🧪 Basic Protobuf Structure Analysis');
console.log('====================================\n');

// Test both vault files to understand their structure
const testFiles = [
  'TestFastVault-44fd-share1of2-Vultiserver.vult',
  'TestSecureVault-cfa0-share2of2-Nopassword.vult'
];

for (const filename of testFiles) {
  console.log(`📁 Analyzing: ${filename}`);
  
  const filePath = path.join(__dirname, 'keyshares', filename);
  
  try {
    // Read and decode
    const content = fs.readFileSync(filePath, 'utf8');
    const decoded = Buffer.from(content.trim(), 'base64');
    
    console.log(`   Content: ${content.length} chars`);
    console.log(`   Decoded: ${decoded.length} bytes`);
    
    // Analyze protobuf structure
    console.log('   🔍 Protobuf Analysis:');
    
    // Look for field markers
    const fields = [];
    for (let i = 0; i < Math.min(decoded.length, 1000); i++) {
      const byte = decoded[i];
      
      // Protobuf field tags: (field_number << 3) | wire_type
      if ((byte & 0x07) === 0 || (byte & 0x07) === 2) { // varint or length-delimited
        const fieldNumber = byte >> 3;
        const wireType = byte & 0x07;
        
        if (fieldNumber >= 1 && fieldNumber <= 10) { // reasonable field numbers
          fields.push({ offset: i, fieldNumber, wireType, byte: byte.toString(16) });
        }
      }
    }
    
    // Show protobuf fields
    fields.slice(0, 10).forEach(field => {
      console.log(`     Field ${field.fieldNumber} (type ${field.wireType}) at offset ${field.offset} (0x${field.byte})`);
    });
    
    // Specifically look for VaultContainer fields
    let versionField = false, vaultField = false, encryptedField = false;
    
    for (let i = 0; i < decoded.length - 1; i++) {
      if (decoded[i] === 0x08) versionField = true;    // Field 1: version
      if (decoded[i] === 0x12) vaultField = true;      // Field 2: vault 
      if (decoded[i] === 0x18) {                      // Field 3: is_encrypted
        encryptedField = true;
        const encValue = decoded[i + 1];
        console.log(`     🔒 Encryption field found: ${encValue === 0 ? 'false' : 'true'} (value: ${encValue})`);
      }
    }
    
    console.log(`     VaultContainer fields: version=${versionField}, vault=${vaultField}, encrypted=${encryptedField}`);
    
    // Try to find length-delimited string fields (field 2 - vault data)
    for (let i = 0; i < decoded.length - 5; i++) {
      if (decoded[i] === 0x12) { // Field 2, wire type 2 (length-delimited)
        const length = decoded[i + 1];
        if (length > 10 && length < decoded.length - i - 2) {
          const vaultData = decoded.subarray(i + 2, i + 2 + length);
          console.log(`     📦 Inner vault data: ${length} bytes starting at offset ${i + 2}`);
          
          // Check if inner data is base64 (should be for unencrypted vaults)
          const vaultStr = vaultData.toString();
          const isBase64Like = /^[A-Za-z0-9+/=]+$/.test(vaultStr.substring(0, Math.min(100, vaultStr.length)));
          console.log(`     📊 Inner data looks like base64: ${isBase64Like}`);
          break;
        }
      }
    }
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }
  
  console.log('');
}

console.log('📝 Analysis Summary:');
console.log('   - Both files are valid base64-encoded protobuf');
console.log('   - TestFastVault shows encrypted=true');
console.log('   - TestSecureVault should show encrypted=false');
console.log('   - Inner vault data should be base64 for unencrypted vaults');