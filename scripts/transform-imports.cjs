#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const filesToTransform = [
  "src/vault/balance/blockchair/integration.ts",
  "src/vault/balance/blockchair/resolvers/cardano.ts",
  "src/vault/balance/blockchair/resolvers/solana.ts",
  "src/vault/balance/blockchair/resolvers/transaction.ts",
  "src/vault/balance/blockchair/resolvers/evm.ts",
  "src/vault/balance/blockchair/index.ts",
  "src/vault/balance/blockchair/config.ts",
  "src/vault/balance/blockchair/config.test.ts",
  "src/vault/balance/blockchair/integration.test.ts",
];

function transformImports(content, filePath) {
  const fileDir = path.dirname(filePath);

  // Transform @core/* imports
  content = content.replace(
    /from ['"]@core\/([^'"]+)['"]/g,
    (match, importPath) => {
      const targetPath = path.join("src/core", importPath);
      let relativePath = path.relative(fileDir, targetPath);

      // Ensure relative path starts with ./
      if (!relativePath.startsWith(".")) {
        relativePath = "./" + relativePath;
      }

      // Replace backslashes with forward slashes (Windows compatibility)
      relativePath = relativePath.replace(/\\/g, "/");

      return `from '${relativePath}'`;
    },
  );

  // Transform @lib/* imports
  content = content.replace(
    /from ['"]@lib\/([^'"]+)['"]/g,
    (match, importPath) => {
      const targetPath = path.join("src/lib", importPath);
      let relativePath = path.relative(fileDir, targetPath);

      // Ensure relative path starts with ./
      if (!relativePath.startsWith(".")) {
        relativePath = "./" + relativePath;
      }

      // Replace backslashes with forward slashes (Windows compatibility)
      relativePath = relativePath.replace(/\\/g, "/");

      return `from '${relativePath}'`;
    },
  );

  return content;
}

console.log("🔄 Transforming workspace imports to relative paths...\n");

let transformedCount = 0;
let errorCount = 0;

for (const file of filesToTransform) {
  const fullPath = path.join(process.cwd(), file);

  try {
    if (!fs.existsSync(fullPath)) {
      console.log(`⚠️  File not found: ${file}`);
      errorCount++;
      continue;
    }

    const originalContent = fs.readFileSync(fullPath, "utf-8");
    const transformedContent = transformImports(originalContent, file);

    if (originalContent !== transformedContent) {
      fs.writeFileSync(fullPath, transformedContent, "utf-8");
      console.log(`✅ ${file}`);
      transformedCount++;
    } else {
      console.log(`⏭️  ${file} (no changes needed)`);
    }
  } catch (error) {
    console.log(`❌ Error transforming ${file}: ${error.message}`);
    errorCount++;
  }
}

console.log(`\n📊 Summary:`);
console.log(`   ✅ Transformed: ${transformedCount} files`);
console.log(`   ❌ Errors: ${errorCount} files`);
