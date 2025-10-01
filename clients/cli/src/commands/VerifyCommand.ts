export class VerifyCommand {
  readonly description = 'Verify fast vault with email verification code'

  async run(options: {
    vaultId?: string
    code?: string
  }): Promise<void> {
    const Vultisig = globalThis.Vultisig
    if (!Vultisig) {
      console.error('❌ SDK not available')
      return
    }

    // Get missing parameters interactively
    const { default: inquirer } = await import('inquirer')

    let vaultId = options.vaultId
    let code = options.code

    if (!vaultId) {
      const response = await inquirer.prompt([
        {
          type: 'input',
          name: 'vaultId',
          message: 'Enter vault ID (ECDSA public key):',
          validate: (input: string) => {
            if (!input || input.trim().length < 60) {
              return 'Please enter a valid vault ID (ECDSA public key)'
            }
            return true
          }
        }
      ])
      vaultId = response.vaultId
    }

    if (!code) {
      const response = await inquirer.prompt([
        {
          type: 'input',
          name: 'code',
          message: 'Enter verification code from email:',
          validate: (input: string) => {
            if (!input || input.trim().length < 4) {
              return 'Please enter the verification code'
            }
            return true
          }
        }
      ])
      code = response.code
    }

    console.log('🔄 Verifying vault...')
    console.log(`   Vault ID: ${vaultId}`)
    console.log(`   Code: ${code}`)

    try {
      const sdk = new Vultisig()
      const verified = await sdk.verifyVault(vaultId, code.trim())

      if (verified) {
        console.log('✅ Email verification successful!')
        console.log('🎉 Your fast vault is now fully activated!')
        console.log('')
        console.log('💡 Next steps:')
        console.log('   - You can now use this vault for signing transactions')
        console.log('   - The vault is backed up on VultiServer')
        console.log('   - Keep your password safe - you need it to retrieve the vault')
      } else {
        console.error('❌ Verification failed - invalid code')
        console.error('')
        console.error('💡 Troubleshooting:')
        console.error('   - Check that you entered the correct verification code')
        console.error('   - Make sure you\'re using the latest code from your email')
        console.error('   - Codes may expire after some time')
      }
    } catch (error) {
      console.error('❌ Verification failed:', (error as Error).message)
      console.error('')
      console.error('💡 Troubleshooting:')
      console.error('   - Check your internet connection')
      console.error('   - Verify the vault ID is correct')
      console.error('   - Try requesting a new verification code')
    }
  }
}

