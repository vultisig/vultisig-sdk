import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables from .env file if it exists
const envPath = path.join(__dirname, 'config', '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log('Loaded integration test environment variables');
} else {
  console.warn(
    'No .env file found at',
    envPath,
    '- using system environment variables'
  );
}

// Validate required environment variables
const requiredEnvVars = ['VAULT_PASSWORD'];

const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);

if (missingVars.length > 0) {
  console.error(
    'Missing required environment variables:',
    missingVars.join(', ')
  );
  console.error('Please create a .env file in tests/integration/config/');
  process.exit(1);
}

console.log('Integration test environment initialized');
console.log('Dry-run mode:', process.env.DRY_RUN === 'true' ? 'ENABLED' : 'DISABLED');
