#!/usr/bin/env tsx

/**
 * Sync and Copy Script
 *
 * 1. Syncs core/ and lib/ directories from vultisig-windows repository
 * 2. Copies needed files to src/core and src/lib with import transformations
 */

import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

const REPO_URL = 'https://github.com/vultisig/vultisig-windows.git'
const TEMP_DIR = '/tmp/vultisig-windows-sync'

const foldersToCopy = [
  'upstream/core/chain',
  'upstream/core/mpc',
  'upstream/core/config',
  'upstream/lib/utils',
  'upstream/lib/dkls',
  'upstream/lib/schnorr',
]

type SyncAndCopyOptions = {
  syncOnly?: boolean
  copyOnly?: boolean
  directories?: Array<'core' | 'lib' | 'clients'>
}

class SyncAndCopier {
  private projectRoot: string
  private copied: string[] = []
  private errors: string[] = []

  constructor() {
    this.projectRoot = process.cwd()
  }

  async run(options: SyncAndCopyOptions = {}): Promise<void> {
    console.log('🚀 Sync and Copy: Full workflow')
    console.log('='.repeat(50))

    try {
      this.checkPrerequisites()

      if (!options.copyOnly) {
        await this.syncFromRemote(options.directories)
      }

      if (!options.syncOnly) {
        await this.copyToSrc()
      }

      console.log('\n✅ All operations completed successfully!')
      this.showNextSteps()
    } catch (error) {
      console.error('\n❌ Operation failed:', error)
      process.exit(1)
    }
  }

  private checkPrerequisites(): void {
    console.log('🔍 Checking prerequisites...')

    try {
      execSync('git rev-parse --git-dir', { stdio: 'ignore' })
    } catch {
      throw new Error('Not in a git repository')
    }

    if (!fs.existsSync(path.join(this.projectRoot, 'package.json'))) {
      throw new Error('Not in project root (package.json not found)')
    }

    try {
      execSync('git sparse-checkout --help', { stdio: 'ignore' })
    } catch {
      throw new Error('Git sparse-checkout not supported (requires Git 2.25+)')
    }

    console.log('✅ Prerequisites checked\n')
  }

  private async syncFromRemote(
    directories?: Array<'core' | 'lib' | 'clients'>
  ): Promise<void> {
    const dirsToSync = directories || ['core', 'lib', 'clients']

    console.log('📥 STEP 1: Sync from vultisig-windows')
    console.log('='.repeat(50))

    for (const dir of dirsToSync) {
      await this.syncDirectory(dir)
    }
  }

  private async syncDirectory(dirName: string): Promise<void> {
    console.log(`\n🔄 Syncing ${dirName}/ directory...`)

    if (fs.existsSync(TEMP_DIR)) {
      fs.rmSync(TEMP_DIR, { recursive: true, force: true })
    }
    fs.mkdirSync(TEMP_DIR, { recursive: true })

    try {
      console.log('   📥 Cloning repository with sparse checkout...')
      execSync(
        `git clone --filter=blob:none --sparse ${REPO_URL} ${TEMP_DIR}`,
        {
          stdio: 'pipe',
        }
      )

      process.chdir(TEMP_DIR)

      // For clients, only sync the extension subdirectory (not desktop)
      // Extension is reference code for the browser extension client
      const sparsePath = dirName === 'clients' ? 'clients/extension' : dirName
      execSync(`git sparse-checkout set ${sparsePath}`, { stdio: 'pipe' })

      if (!fs.existsSync(path.join(TEMP_DIR, sparsePath))) {
        throw new Error(`Directory ${sparsePath}/ not found in remote repository`)
      }

      console.log(`   📋 Copying ${dirName}/ to project...`)
      const targetPath = path.join(this.projectRoot, 'upstream', dirName)
      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true })
      }
      fs.mkdirSync(path.dirname(targetPath), { recursive: true })
      this.copyDirectoryRecursive(path.join(TEMP_DIR, dirName), targetPath)

      console.log(`   ✅ Successfully synced ${dirName}/`)

      const packageCount = this.countPackageJsonFiles(targetPath)
      console.log(`   📊 Contains ${packageCount} package.json files`)
    } finally {
      process.chdir(this.projectRoot)
      if (fs.existsSync(TEMP_DIR)) {
        fs.rmSync(TEMP_DIR, { recursive: true, force: true })
      }
    }
  }

  private copyDirectoryRecursive(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true })

    const entries = fs.readdirSync(src, { withFileTypes: true })
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name)
      const destPath = path.join(dest, entry.name)

      if (entry.isDirectory()) {
        this.copyDirectoryRecursive(srcPath, destPath)
      } else {
        fs.copyFileSync(srcPath, destPath)
      }
    }
  }

  private countPackageJsonFiles(dir: string): number {
    let count = 0
    if (!fs.existsSync(dir)) return 0

    const walk = (currentDir: string) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          walk(path.join(currentDir, entry.name))
        } else if (entry.name === 'package.json') {
          count++
        }
      }
    }

    walk(dir)
    return count
  }

  private async copyToSrc(): Promise<void> {
    console.log('\n📋 STEP 2: Copy to packages/ with import transformations')
    console.log('='.repeat(50))
    console.log(`📊 Copy plan: ${foldersToCopy.length} folders\n`)

    await this.cleanSrcDirectories()

    for (const folder of foldersToCopy) {
      await this.copyFolder(folder)
    }

    this.generateCopyReport()
  }

  private async cleanSrcDirectories(): Promise<void> {
    console.log('🧹 Cleaning packages/core and packages/lib...')

    const srcCore = path.join(this.projectRoot, 'packages/core')
    const srcLib = path.join(this.projectRoot, 'packages/lib')

    if (fs.existsSync(srcCore)) {
      fs.rmSync(srcCore, { recursive: true, force: true })
    }
    if (fs.existsSync(srcLib)) {
      fs.rmSync(srcLib, { recursive: true, force: true })
    }
  }

  private async copyFolder(folderPath: string): Promise<void> {
    const sourcePath = path.join(this.projectRoot, folderPath)
    // Strip 'upstream/' prefix for destination path
    const destRelativePath = folderPath.replace(/^upstream\//, '')
    const destPath = path.join(this.projectRoot, 'packages', destRelativePath)

    if (!fs.existsSync(sourcePath)) {
      this.errors.push(`Source folder not found: ${folderPath}`)
      return
    }

    try {
      fs.mkdirSync(path.dirname(destPath), { recursive: true })

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
      } else if (entry.name.endsWith('.wasm')) {
        // Copy WASM files directly without transformation
        fs.copyFileSync(srcPath, destPath)
      } else if (
        entry.name.endsWith('.ts') ||
        entry.name.endsWith('.tsx') ||
        entry.name.endsWith('.js') ||
        entry.name.endsWith('.d.ts')
      ) {
        const content = fs.readFileSync(srcPath, 'utf-8')
        const transformedContent = this.transformImports(content, destPath)
        fs.writeFileSync(destPath, transformedContent)
      }
    }
  }

  private async copyFile(filePath: string): Promise<void> {
    const sourcePath = path.join(this.projectRoot, filePath)
    // Strip 'upstream/' prefix for destination path
    const destRelativePath = filePath.replace(/^upstream\//, '')
    const destPath = path.join(this.projectRoot, 'packages', destRelativePath)

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

    transformed = transformed.replace(/@core\/([^'"]*)/g, (_match, corePath) => {
      const destDir = path.dirname(destinationPath)
      const targetPath = path.join(this.projectRoot, 'packages/core', corePath)
      const relativePath = path.relative(destDir, targetPath)
      return relativePath.startsWith('.') ? relativePath : './' + relativePath
    })

    transformed = transformed.replace(/@lib\/([^'"]*)/g, (_match, libPath) => {
      const destDir = path.dirname(destinationPath)
      const targetPath = path.join(this.projectRoot, 'packages/lib', libPath)
      const relativePath = path.relative(destDir, targetPath)
      return relativePath.startsWith('.') ? relativePath : './' + relativePath
    })

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
        } else if (
          entry.name.endsWith('.ts') ||
          entry.name.endsWith('.tsx') ||
          entry.name.endsWith('.js')
        ) {
          count++
        }
      }
    }

    walk(dir)
    return count
  }

  private generateCopyReport(): void {
    console.log('\n📋 Copy Report')
    console.log('='.repeat(50))

    console.log(`✅ Copied: ${this.copied.length} items`)
    console.log(`❌ Errors: ${this.errors.length}`)

    if (this.errors.length > 0) {
      console.log('\n❌ Errors:')
      this.errors.forEach(error => console.log(`   ${error}`))
    }

    const srcCore = path.join(this.projectRoot, 'packages/core')
    const srcLib = path.join(this.projectRoot, 'packages/lib')
    const totalFiles = this.countFiles(srcCore) + this.countFiles(srcLib)

    console.log(`\n🎯 Result:`)
    console.log(`   📁 Total files: ${totalFiles}`)
    console.log(`   📦 Core: ${this.countFiles(srcCore)}`)
    console.log(`   📦 Lib: ${this.countFiles(srcLib)}`)
  }

  private showNextSteps(): void {
    console.log('\n📝 Next Steps:')
    console.log('   1. Test the build: yarn install && yarn build')
    console.log('   2. Review changes: git status')
    console.log(
      '   3. Commit updates: git add . && git commit -m "Sync and copy from vultisig-windows"'
    )
  }
}

const parseArgs = (): SyncAndCopyOptions => {
  const args = process.argv.slice(2)
  const options: SyncAndCopyOptions = {}

  if (args.includes('--sync-only')) {
    options.syncOnly = true
  }
  if (args.includes('--copy-only')) {
    options.copyOnly = true
  }
  if (args.includes('--core-only')) {
    options.directories = ['core']
  }
  if (args.includes('--lib-only')) {
    options.directories = ['lib']
  }
  if (args.includes('--clients-only')) {
    options.directories = ['clients']
  }
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Sync and Copy Script

Usage:
  yarn sync-and-copy [options]

Options:
  --sync-only      Only sync from remote, skip copy to src/
  --copy-only      Only copy to src/, skip remote sync
  --core-only      Only process core/ directory
  --lib-only       Only process lib/ directory
  --clients-only   Only process clients/extension (reference code only)
  --help, -h       Show this help message

Examples:
  yarn sync-and-copy                  # Full workflow (sync core, lib, clients/extension)
  yarn sync-and-copy --sync-only      # Only sync from remote
  yarn sync-and-copy --copy-only      # Only copy to src/
  yarn sync-and-copy --core-only      # Only process core/
  yarn sync-and-copy --clients-only   # Only sync clients/extension reference
    `)
    process.exit(0)
  }

  return options
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs()
  const syncer = new SyncAndCopier()
  syncer.run(options).catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
}

export { SyncAndCopier }
