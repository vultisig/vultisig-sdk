#!/usr/bin/env tsx

/**
 * Ultra Simple Copy Script
 * 
 * Just copy the major folders we need - no complex analysis
 */

import * as fs from 'fs'
import * as path from 'path'

// Ultra simple: Just copy these major folders
const foldersToCoopy = [
  'core/chain',     // All chain functionality
  'core/mpc',       // All MPC functionality  
  'core/config',    // Config
  'lib/utils',      // All utilities
  'lib/dkls',       // WASM
  'lib/schnorr'     // WASM
]

// Individual files not in folders above
const individualFiles = [
  'core/ui/vault/Vault.ts',
  'core/ui/vault/import/utils/vaultContainerFromString.ts',
  'core/ui/security/password/config.ts',
  'core/ui/mpc/session/utils/startMpcSession.ts',  //move
  'lib/ui/utils/initiateFileDownload.ts'  
]

// CRITICAL RULE: DO NOT MODIFY FILES IN src/core OR src/lib
// These are copied from the main core/ and lib/ directories and should remain unchanged.
// Fix build issues through configuration changes, not by modifying the copied source files.

class UltraSimpleCopier {
  private projectRoot: string
  private copied: string[] = []
  private errors: string[] = []

  constructor() {
    this.projectRoot = process.cwd()
  }

  async copyAll(): Promise<void> {
    console.log('⚡ Ultra Simple Copy: Just copy the major folders!')
    console.log(`📊 Copy plan: ${foldersToCoopy.length} folders + ${individualFiles.length} files`)
    
    // Clean existing
    await this.cleanDirectories()
    
    // Copy folders
    for (const folder of foldersToCoopy) {
      await this.copyFolder(folder)
    }
    
    // Copy individual files
    for (const file of individualFiles) {
      await this.copyFile(file)
    }
    
    this.generateReport()
  }

  private async cleanDirectories(): Promise<void> {
    console.log('🧹 Cleaning src/core and src/lib...')
    
    const srcCore = path.join(this.projectRoot, 'src/core')
    const srcLib = path.join(this.projectRoot, 'src/lib')
    
    if (fs.existsSync(srcCore)) {
      fs.rmSync(srcCore, { recursive: true, force: true })
    }
    if (fs.existsSync(srcLib)) {
      fs.rmSync(srcLib, { recursive: true, force: true })
    }
  }

  private async copyFolder(folderPath: string): Promise<void> {
    const sourcePath = path.join(this.projectRoot, folderPath)
    const destPath = path.join(this.projectRoot, 'src', folderPath)
    
    if (!fs.existsSync(sourcePath)) {
      this.errors.push(`Source folder not found: ${folderPath}`)
      return
    }
    
    try {
      // Create destination parent
      fs.mkdirSync(path.dirname(destPath), { recursive: true })
      
      // Copy entire folder
      this.copyFolderRecursive(sourcePath, destPath)
      
      const fileCount = this.countFiles(destPath)
      this.copied.push(folderPath)
      
      console.log(`✅ ${folderPath} (${fileCount} files)`)
    } catch (error) {
      this.errors.push(`Failed to copy folder ${folderPath}: ${error}`)
    }
  }

  private copyFolderRecursive(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true })
    
    const entries = fs.readdirSync(src, { withFileTypes: true })
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name)
      const destPath = path.join(dest, entry.name)
      
      if (entry.isDirectory()) {
        this.copyFolderRecursive(srcPath, destPath)
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.js') || entry.name.endsWith('.d.ts')) {
        const content = fs.readFileSync(srcPath, 'utf-8')
        const transformedContent = this.transformImports(content, destPath)
        fs.writeFileSync(destPath, transformedContent)
      }
    }
  }

  private async copyFile(filePath: string): Promise<void> {
    const sourcePath = path.join(this.projectRoot, filePath)
    const destPath = path.join(this.projectRoot, 'src', filePath)
    
    if (!fs.existsSync(sourcePath)) {
      this.errors.push(`Source file not found: ${filePath}`)
      return
    }
    
    try {
      fs.mkdirSync(path.dirname(destPath), { recursive: true })
      
      const content = fs.readFileSync(sourcePath, 'utf-8')
      const transformedContent = this.transformImports(content, destPath)
      fs.writeFileSync(destPath, transformedContent)
      
      this.copied.push(filePath)
      console.log(`✅ ${filePath}`)
    } catch (error) {
      this.errors.push(`Failed to copy file ${filePath}: ${error}`)
    }
  }

  private transformImports(content: string, destinationPath: string): string {
    let transformed = content

    // Transform @core/* imports to relative paths
    transformed = transformed.replace(
      /@core\/([^'"]*)/g,
      (match, corePath) => {
        const destDir = path.dirname(destinationPath)
        const targetPath = path.join(this.projectRoot, 'src/core', corePath)
        const relativePath = path.relative(destDir, targetPath)
        return relativePath.startsWith('.') ? relativePath : './' + relativePath
      }
    )

    // Transform @lib/* imports to relative paths
    transformed = transformed.replace(
      /@lib\/([^'"]*)/g,
      (match, libPath) => {
        const destDir = path.dirname(destinationPath)
        const targetPath = path.join(this.projectRoot, 'src/lib', libPath)
        const relativePath = path.relative(destDir, targetPath)
        return relativePath.startsWith('.') ? relativePath : './' + relativePath
      }
    )

    return transformed
  }

  private countFiles(dir: string): number {
    let count = 0
    
    if (!fs.existsSync(dir)) return 0
    
    const walk = (currentDir: string) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          walk(path.join(currentDir, entry.name))
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.js')) {
          count++
        }
      }
    }
    
    walk(dir)
    return count
  }

  private generateReport(): void {
    console.log('\n⚡ Ultra Simple Copy Report')
    console.log('='.repeat(40))
    
    console.log(`✅ Copied: ${this.copied.length} items`)
    console.log(`❌ Errors: ${this.errors.length}`)
    
    if (this.errors.length > 0) {
      console.log('\n❌ Errors:')
      this.errors.forEach(error => console.log(`   ${error}`))
    }
    
    // Count total files
    const srcCore = path.join(this.projectRoot, 'src/core')
    const srcLib = path.join(this.projectRoot, 'src/lib')
    const totalFiles = this.countFiles(srcCore) + this.countFiles(srcLib)
    
    console.log(`\n🎯 Result:`)
    console.log(`   📁 Total files: ${totalFiles}`)
    console.log(`   📦 Core: ${this.countFiles(srcCore)}`)
    console.log(`   📦 Lib: ${this.countFiles(srcLib)}`)
    console.log(`   ⚡ Operations: ${this.copied.length} (ultra simple!)`)
    
    // Generate detailed file list
    this.generateFileList()
    
    console.log('\n📝 Test: cd src && yarn build')
  }

  private generateFileList(): void {
    console.log('\n📋 Complete File Copy List:')
    console.log('='.repeat(40))
    
    console.log('\n📁 FOLDERS COPIED:')
    foldersToCoopy.forEach(folder => {
      const destPath = path.join(this.projectRoot, 'src', folder)
      const fileCount = this.countFiles(destPath)
      console.log(`   ✅ ${folder} (${fileCount} files)`)
    })
    
    console.log('\n📄 INDIVIDUAL FILES COPIED:')
    individualFiles.forEach(file => {
      const destPath = path.join(this.projectRoot, 'src', file)
      const exists = fs.existsSync(destPath) ? '✅' : '❌'
      console.log(`   ${exists} ${file}`)
    })
    
    console.log('\n🔧 MANUALLY ADDED FILES (not in script):')
    // Check for files that were manually added
    const manualFiles = this.findManuallyAddedFiles()
    if (manualFiles.length > 0) {
      manualFiles.forEach(file => console.log(`   ⚠️  ${file}`))
    } else {
      console.log('   (none detected)')
    }
  }

  private findManuallyAddedFiles(): string[] {
    const manualFiles: string[] = []
    const srcCore = path.join(this.projectRoot, 'src/core')
    const srcLib = path.join(this.projectRoot, 'src/lib')
    
    // This is a simplified check - in practice, you'd compare with the copy plan
    // For now, just note any UI files that aren't in our individual files list
    const checkForManualUiFiles = (dir: string, prefix: string) => {
      if (!fs.existsSync(dir)) return
      
      const walk = (currentDir: string) => {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name)
          if (entry.isDirectory()) {
            walk(fullPath)
          } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
            const relativePath = path.relative(path.join(this.projectRoot, 'src'), fullPath)
            if (relativePath.includes('/ui/') && !individualFiles.some(f => relativePath.endsWith(f))) {
              manualFiles.push(relativePath)
            }
          }
        }
      }
      
      walk(dir)
    }
    
    checkForManualUiFiles(srcCore, 'core')
    checkForManualUiFiles(srcLib, 'lib')
    
    return manualFiles
  }
}

// Run ultra simple copy
if (import.meta.url === `file://${process.argv[1]}`) {
  const copier = new UltraSimpleCopier()
  copier.copyAll().catch(console.error)
}

export { UltraSimpleCopier }
