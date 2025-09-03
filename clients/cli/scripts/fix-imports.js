#!/usr/bin/env node

// Fix imports script - converts TypeScript path aliases to relative paths for pkg compatibility

const fs = require('fs');
const path = require('path');

function fixImportsInFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Replace @core imports with relative paths
  let fixed = content.replace(/require\(['"]@core\/(.*?)['"]\)/g, (match, corePath) => {
    return `require('../core/${corePath}')`;
  });
  
  // Replace @lib imports with relative paths  
  fixed = fixed.replace(/require\(['"]@lib\/(.*?)['"]\)/g, (match, libPath) => {
    return `require('../lib/${libPath}')`;
  });
  
  if (fixed !== content) {
    fs.writeFileSync(filePath, fixed);
    console.log(`✅ Fixed imports in: ${path.relative(process.cwd(), filePath)}`);
  }
}

function walkDirectory(dir) {
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      walkDirectory(fullPath);
    } else if (file.endsWith('.js')) {
      fixImportsInFile(fullPath);
    }
  }
}

// Main execution
const buildDir = process.argv[2] || '/tmp/vultisig-cli-build';

console.log('🔧 Fixing imports for pkg compatibility...');
console.log(`📁 Build directory: ${buildDir}`);

walkDirectory(buildDir);

console.log('✅ Import fixing completed!');