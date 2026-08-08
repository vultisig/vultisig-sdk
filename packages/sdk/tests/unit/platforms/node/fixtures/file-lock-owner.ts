import * as fs from 'node:fs/promises'

import { tryLockFile } from '../../../../../src/platforms/node/fileLock'

const lockPath = process.argv[2]
if (!lockPath) throw new Error('Expected a lock path')

const lockHandle = await fs.open(lockPath, 'a+', 0o600)
while (!tryLockFile(lockHandle.fd)) {
  await new Promise(resolve => setTimeout(resolve, 10))
}

process.stdout.write('locked\n')
setInterval(() => undefined, 1_000)
