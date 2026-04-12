/**
 * Ensures packages/mpc-native/android/libs/*.aar are real ZIP archives before npm publish.
 *
 * If the working tree has Git LFS pointer files (e.g. org LFS bandwidth exhausted),
 * downloads the same filenames from a GitHub Release on this repo:
 *
 *   https://github.com/<repo>/releases/download/<tag>/dkls-release.aar
 *   https://github.com/<repo>/releases/download/<tag>/goschnorr-release.aar
 *
 * Set repo Actions variable MPC_NATIVE_AARS_DOWNLOAD_TAG, or env MPC_NATIVE_AARS_BASE_URL
 * (full URL prefix, no trailing slash). Optional: MPC_NATIVE_AARS_REPO (default: github.repository in CI).
 */
import fs from 'node:fs'
import path from 'node:path'

const LIBS = path.join('packages', 'mpc-native', 'android', 'libs')
const AARS = ['dkls-release.aar', 'goschnorr-release.aar']

function readHead(filePath, n) {
  const fd = fs.openSync(filePath, 'r')
  try {
    const buf = Buffer.alloc(n)
    const read = fs.readSync(fd, buf, 0, n, 0)
    return buf.subarray(0, read)
  } finally {
    fs.closeSync(fd)
  }
}

function isLfsPointer(buf) {
  const s = buf.toString('utf8', 0, Math.min(buf.length, 64))
  return s.startsWith('version https://git-lfs.github.com/spec/v1')
}

function isProbablyZip(buf) {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b
}

function downloadUrlFor(name) {
  const baseEnv = process.env.MPC_NATIVE_AARS_BASE_URL?.trim()
  if (baseEnv) {
    return `${baseEnv.replace(/\/$/, '')}/${encodeURIComponent(name)}`
  }
  const tag = process.env.MPC_NATIVE_AARS_DOWNLOAD_TAG?.trim()
  const repo = process.env.MPC_NATIVE_AARS_REPO?.trim() || 'vultisig/vultisig-sdk'
  if (!tag) {
    return null
  }
  const encTag = encodeURIComponent(tag)
  const encName = encodeURIComponent(name)
  return `https://github.com/${repo}/releases/download/${encTag}/${encName}`
}

async function downloadToFile(url, dest) {
  const headers = {}
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  const res = await fetch(url, { headers })
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(dest, buf)
}

function verifyAllOrThrow() {
  const errors = []
  for (const name of AARS) {
    const p = path.join(LIBS, name)
    if (!fs.existsSync(p)) {
      errors.push(`missing ${p}`)
      continue
    }
    const st = fs.statSync(p)
    if (st.size < 10_000) {
      errors.push(`${name} is too small (${st.size} bytes); expected a real .aar (ZIP)`)
      continue
    }
    const head = readHead(p, 128)
    if (isLfsPointer(head)) {
      errors.push(`${name} is still a Git LFS pointer file`)
      continue
    }
    if (!isProbablyZip(head)) {
      errors.push(`${name} does not look like a ZIP (.aar); expected PK header`)
    }
  }
  if (errors.length) {
    throw new Error(errors.join('\n'))
  }
}

async function main() {
  for (const name of AARS) {
    const p = path.join(LIBS, name)
    if (!fs.existsSync(p)) {
      throw new Error(`missing ${p}`)
    }
    const head = readHead(p, 128)
    if (isProbablyZip(head) && !isLfsPointer(head)) {
      continue
    }
    if (!isLfsPointer(head)) {
      throw new Error(
        `${name} is neither a Git LFS pointer nor a ZIP. Remove or replace it, then retry.`,
      )
    }
    const url = downloadUrlFor(name)
    if (!url) {
      throw new Error(
        [
          `${name} is a Git LFS pointer and LFS fetch is unavailable (org LFS budget).`,
          'Fix one of:',
          '  1. Increase GitHub LFS data/bandwidth for the org, or',
          '  2. Set repo Actions variable MPC_NATIVE_AARS_DOWNLOAD_TAG to a release tag that contains',
          '     dkls-release.aar and goschnorr-release.aar as release assets, or',
          '  3. Set env MPC_NATIVE_AARS_BASE_URL to a URL prefix that serves those filenames, or',
          '  4. Commit real .aar binaries and remove Git LFS tracking for packages/mpc-native/android/libs/*.aar',
        ].join('\n'),
      )
    }
    console.log(`Downloading ${name} from ${url}`)
    await downloadToFile(url, p)
  }

  verifyAllOrThrow()
  console.log('mpc-native Android .aar files are valid ZIP archives.')
}

await main()
