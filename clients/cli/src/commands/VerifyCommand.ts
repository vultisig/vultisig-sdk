export class VerifyCommand {
  readonly description =
    'Verify fast vault with email code or check vault existence'

  async run(options: {
    vaultId?: string
    email?: string
    password?: string
  }): Promise<void> {
    const Vultisig = globalThis.Vultisig
    if (!Vultisig) {
      console.error('❌ SDK not available')
      return
    }

    const vaultId = options.vaultId
    if (!vaultId) {
      console.error('❌ --vault-id is required')
      return
    }

    if (!options.email && !options.password) {
      console.error('❌ Either --email or --password flag is required')
      console.error('   Use --email <code> to verify email code')
      console.error('   Use --password <password> to check vault existence')
      return
    }

    if (options.email && options.password) {
      console.error('❌ Cannot use both --email and --password flags')
      console.error('   Use either --email <code> OR --password <password>')
      return
    }

    const sdk = new Vultisig()

    if (options.email) {
      await this.verifyEmailCode(sdk, vaultId, options.email)
    } else if (options.password) {
      await this.checkVaultExists(sdk, vaultId, options.password)
    }
  }

  private async verifyEmailCode(
    sdk: any,
    vaultId: string,
    code: string
  ): Promise<void> {
    console.log('🔄 Verifying email code...')
    console.log(`   Vault ID: ${vaultId}`)
    console.log(`   Code: ${code}`)

    try {
      const verified = await sdk.verifyVault(vaultId, code.trim())

      if (verified) {
        console.log('✅ Email verification successful!')
        console.log('🎉 Your fast vault is now fully activated!')
        console.log('')
        console.log('💡 Next steps:')
        console.log('   - You can now use this vault for signing transactions')
        console.log('   - The vault is backed up on VultiServer')
        console.log(
          '   - Keep your password safe - you need it to retrieve the vault'
        )
      } else {
        console.error('❌ Verification failed - invalid code')
        console.error('')
        console.error('💡 Troubleshooting:')
        console.error(
          '   - Check that you entered the correct verification code'
        )
        console.error(
          "   - Make sure you're using the latest code from your email"
        )
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

  private async checkVaultExists(
    sdk: any,
    vaultId: string,
    password: string
  ): Promise<void> {
    console.log('🔄 Checking vault existence on server...')

    try {
      await sdk.getVault(vaultId, password)
      console.log('✅ YES')
    } catch {
      console.log('❌ NO')
    }
  }
}
