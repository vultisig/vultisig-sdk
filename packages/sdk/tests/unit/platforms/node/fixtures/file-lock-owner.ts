import * as fs from 'node:fs/promises'

import { tryLockFile } from '../../../../../src/platforms/node/fileLock'

const lockPath = process.argv[2]
if (!lockPath) throw new Error('Expected a lock path')

const lockHandle = await fs.open(lockPath, 'a+', 0o600)
const lockDeadline = Date.now() + 5_000
while (!tryLockFile(lockHandle.fd)) {
  if (Date.now() >= lockDeadline) {
    await lockHandle.close()
    throw new Error(`Timed out acquiring the test lock at ${lockPath}`)
  }
  await new Promise(resolve => setTimeout(resolve, 10))
}

process.stdout.write('locked\n')
setInterval(() => undefined, 1_000)
