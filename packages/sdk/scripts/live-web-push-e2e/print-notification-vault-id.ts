/**
 * Print notification vault_id from ECDSA pubkey + hex chain code (same as iOS / SDK).
 *
 *   PUSH_E2E_ECDSA_HEX=... PUSH_E2E_HEX_CHAIN_CODE=... yarn workspace @vultisig/sdk live-push-e2e:print-vault-id
 */
import { computeNotificationVaultId } from '../../src/utils/computeNotificationVaultId'

async function main(): Promise<void> {
  const ecdsa = process.env.PUSH_E2E_ECDSA_HEX?.trim()
  const chain = process.env.PUSH_E2E_HEX_CHAIN_CODE?.trim()
  if (!ecdsa || !chain) {
    console.error('Set PUSH_E2E_ECDSA_HEX and PUSH_E2E_HEX_CHAIN_CODE')
    process.exit(1)
  }
  const id = await computeNotificationVaultId(ecdsa, chain)
  console.log(id)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
