# Pre-commit Hooks Setup Guide

This guide explains how to set up pre-commit hooks for the Vultisig SDK project using Husky and lint-staged.

## Prerequisites

- Node.js 18+ installed
- Yarn package manager
- Git repository initialized

## Installation Steps

### 1. Install Dependencies

From the project root, install Husky and lint-staged:

```bash
yarn add -D husky lint-staged
```

### 2. Initialize Husky

Initialize Husky in your project:

```bash
npx husky init
```

This creates a `.husky` directory with Git hooks.

### 3. Create Pre-commit Hook

Create the pre-commit hook file:

```bash
cat > .husky/pre-commit << 'EOF'
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

# Run lint-staged
npx lint-staged

# Run tests for changed files
echo "Running tests for changed files..."
cd packages/sdk && npm run test:changed
EOF

chmod +x .husky/pre-commit
```

### 4. Configure lint-staged

Add the following configuration to `package.json` at the root level:

```json
{
  "lint-staged": {
    "packages/**/*.{ts,tsx}": [
      "eslint --fix",
      "prettier --write"
    ],
    "packages/sdk/tests/**/*.test.ts": [
      "vitest related --run"
    ],
    "packages/sdk/tests/fixtures/**/*.json": [
      "node scripts/validate-fixtures.js"
    ]
  }
}
```

### 5. Add Package Scripts

Add these scripts to the root `package.json`:

```json
{
  "scripts": {
    "prepare": "husky install",
    "test:changed": "yarn workspace @vultisig/sdk test:changed"
  }
}
```

And add this script to `packages/sdk/package.json`:

```json
{
  "scripts": {
    "test:changed": "vitest related --run"
  }
}
```

### 6. Create Fixture Validation Script

Create `scripts/validate-fixtures.js`:

```javascript
#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';

const FIXTURES_DIR = path.join(process.cwd(), 'packages/sdk/tests/fixtures/chains');

async function validateFixtures() {
  const requiredFiles = ['addresses.json', 'transactions.json', 'balances.json', 'rpc-responses.json'];
  const chainDirs = await fs.readdir(FIXTURES_DIR);

  let errors = 0;

  for (const chainDir of chainDirs) {
    const chainPath = path.join(FIXTURES_DIR, chainDir);
    const stats = await fs.stat(chainPath);

    if (!stats.isDirectory()) continue;

    console.log(`Validating ${chainDir}...`);

    for (const file of requiredFiles) {
      const filePath = path.join(chainPath, file);

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        JSON.parse(content); // Validate JSON
        console.log(`  ✓ ${file}`);
      } catch (error) {
        console.error(`  ✗ ${file}: ${error.message}`);
        errors++;
      }
    }
  }

  if (errors > 0) {
    console.error(`\n❌ Found ${errors} fixture validation errors`);
    process.exit(1);
  }

  console.log('\n✅ All fixtures are valid');
}

validateFixtures().catch(error => {
  console.error('Validation failed:', error);
  process.exit(1);
});
```

Make it executable:

```bash
chmod +x scripts/validate-fixtures.js
```

## What the Pre-commit Hook Does

When you commit code, the pre-commit hook will automatically:

1. **Lint and Format**: Run ESLint and Prettier on changed TypeScript files
2. **Run Tests**: Execute tests related to changed files
3. **Validate Fixtures**: Check that chain fixture files are valid JSON

If any step fails, the commit will be blocked until you fix the issues.

## Skipping Hooks (Emergency Use Only)

In rare cases where you need to skip the pre-commit hook:

```bash
git commit -m "message" --no-verify
```

**Warning**: Only use this in emergencies. The hooks are there to maintain code quality.

## Troubleshooting

### Hook not running

If the hook doesn't run, ensure it's executable:

```bash
chmod +x .husky/pre-commit
```

### Hook failing

Check the error messages. Common issues:
- Linting errors: Run `yarn lint:fix`
- Test failures: Run `yarn test` to see failures
- Fixture errors: Check JSON syntax in fixture files

### Husky not found

Make sure you ran `yarn install` after adding Husky:

```bash
yarn install
npx husky install
```

## Testing the Setup

Test that the pre-commit hook works:

```bash
# Make a small change
echo "// test" >> packages/sdk/src/ChainManager.ts

# Try to commit
git add .
git commit -m "test: verify pre-commit hook"

# You should see the hook running
# Revert the test change
git reset HEAD~1
```

## Benefits

Pre-commit hooks ensure:
- ✅ Code is linted before committing
- ✅ Code is formatted consistently
- ✅ Tests pass for changed code
- ✅ Fixture files are valid
- ✅ Higher code quality
- ✅ Fewer CI failures

## Next Steps

After setting up pre-commit hooks:
1. Ensure all team members run `yarn install` to set up hooks
2. Add hook setup to onboarding documentation
3. Consider adding additional hooks (pre-push, commit-msg, etc.)
