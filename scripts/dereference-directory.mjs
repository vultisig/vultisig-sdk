/**
 * Replace a directory tree with a deep copy that dereferences symlinks.
 * Used before npm pack: registries reject tarballs containing symlinks (e.g. Apple .framework bundles).
 *
 * Run with cwd = the package root (same as npm/yarn lifecycle scripts).
 * Staging uses a temp directory next to the target so renames stay on one filesystem (avoids EXDEV
 * when /tmp is tmpfs). After a local pack/publish test: git checkout -- <path>
 *
 * Node's fs.cpSync(..., { dereference: true }) can leave absolute symlinks in macOS
 * .framework trees; `cp -RL` follows them reliably on Linux (CI) and Darwin.
 *
 * Merge / runtime impact:
 * - prepack runs only for `npm pack` / `npm publish` (and Yarn equivalents), not for `yarn install`
 *   or normal app builds. Day-to-day dev and CI test jobs are unchanged.
 * - Published tarball layout (paths, podspec `Frameworks/...`) matches the symlinked tree; only the
 *   on-disk representation becomes real files, which CocoaPods and Xcode accept.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, renameSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const rel = process.argv[2]
if (!rel) {
  console.error('usage: node dereference-directory.mjs <path-relative-to-cwd>')
  process.exit(1)
}

const target = path.resolve(process.cwd(), rel)
if (!existsSync(target)) {
  console.error(`dereference-directory: not found: ${target}`)
  process.exit(1)
}
if (!statSync(target).isDirectory()) {
  console.error(`dereference-directory: not a directory: ${target}`)
  process.exit(1)
}

const parentDir = path.dirname(target)
const baseName = path.basename(target)
const tmpRoot = mkdtempSync(path.join(parentDir, '.deref-'))
const staged = path.join(tmpRoot, baseName)
const oldAside = path.join(tmpRoot, '.old-tree')

function copyDereferenced(src, dest) {
  if (process.platform === 'win32') {
    cpSync(src, dest, { recursive: true, dereference: true })
    return
  }
  const r = spawnSync('cp', ['-RL', src, dest], { stdio: 'inherit' })
  if (r.error) {
    throw new Error(`dereference-directory: cp failed to start: ${r.error.message}`)
  }
  if (r.status !== 0) {
    throw new Error(`dereference-directory: cp exited with code ${r.status ?? 'unknown'}`)
  }
}

try {
  copyDereferenced(target, staged)
  renameSync(target, oldAside)
  renameSync(staged, target)
} catch (err) {
  if (existsSync(oldAside) && !existsSync(target)) {
    try {
      renameSync(oldAside, target)
    } catch {
      /* best-effort restore; rethrow original below */
    }
  }
  throw err
} finally {
  rmSync(tmpRoot, { recursive: true, force: true })
}

console.log(`dereference-directory: rewrote ${rel} (symlinks → real files)`)
