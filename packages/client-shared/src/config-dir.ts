import { homedir } from 'node:os'
import { join } from 'node:path'

export function getVultisigConfigDir(): string {
  const override = process.env.VULTISIG_CONFIG_DIR?.trim()
  return override ? override : join(homedir(), '.vultisig')
}
