export class CreateCommand {
  readonly description = 'Create a new vault (fast by default)'

  async run(options: {
    name?: string
    email?: string
    password?: string
    mode?: 'fast' | 'relay' | 'local'
  }): Promise<void> {
    const Vultisig = globalThis.Vultisig
    if (!Vultisig) {
      console.error('❌ SDK not available')
      return
    }

    // Validate required name parameter
    if (!options.name) {
      console.error('❌ Vault name is required')
      console.error('   Usage: create --name "My Vault" [options]')
      return
    }

    const mode = options.mode || 'fast'
    const vaultType = mode === 'fast' ? 'fast' : 'secure'
    // const keygenMode = mode === 'local' ? 'local' : 'relay'

    console.log(`🔐 Creating ${vaultType} vault...`)
    console.log(`   Name: ${options.name}`)
    console.log(`   Mode: ${mode}`)

    try {
      // Get missing parameters interactively
      const { promptForPassword } = await import('../utils/password')
      const { default: inquirer } = await import('inquirer')

      let password = options.password
      let email = options.email

      // For fast vaults, get email if not provided
      if (vaultType === 'fast' && !email) {
        const emailPrompt = await inquirer.prompt([
          {
            type: 'input',
            name: 'email',
            message:
              'Enter email for vault verification (required for fast vaults):',
            validate: (input: string) => {
              if (!input) return 'Email is required for fast vaults'
              if (!input.includes('@')) return 'Please enter a valid email'
              return true
            },
          },
        ])
        email = emailPrompt.email
      }

      // Get password if not provided (optional for secure vaults without encryption)
      if (!password) {
        const usePassword = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'encrypt',
            message: 'Encrypt vault file with password?',
            default: vaultType === 'fast', // Default to true for fast vaults
          },
        ])

        if (usePassword.encrypt) {
          password = await promptForPassword(
            'Enter vault encryption password',
            1,
            1
          )
        }
      }

      // Create SDK instance
      const sdk = new Vultisig()
      await sdk.initialize()

      console.log(
        `📡 ${vaultType === 'fast' ? 'Connecting to VultiServer' : 'Starting MPC keygen'}...`
      )

      let vaultId: string
      let vault: any

      if (vaultType === 'fast') {
        // Import FastVault for fast vault creation
        const { FastVault } = await import('@vultisig/sdk')

        const result = await FastVault.create({
          name: options.name,
          password: password!,
          email: email!,
          onProgress: update => {
            const step = update.step || 'unknown'
            const progress = update.progress || 0
            const message = update.message || 'Processing...'
            if (progress > 0) {
              console.log(`   ${step} (${progress}%): ${message}`)
            } else {
              console.log(`   ${step}: ${message}`)
            }
          },
        })

        vault = result.vault
        vaultId = result.vaultId
      } else {
        // Secure vault creation not yet implemented in this CLI
        throw new Error(
          'Secure vault creation is not yet supported in this CLI. Use fast vault mode.'
        )
      }

      if (vaultType === 'fast') {
        // For fast vaults, handle verification
        console.log('✅ Fast vault created successfully!')
        console.log(`   Vault ID: ${vaultId}`)
        console.log(`   Name: ${vault.name}`)
        console.log(`   Type: Fast (2-of-2 with VultiServer)`)
        console.log(`   Signers: ${vault.signers.length}`)

        // Check if verification is needed (fast vaults typically require verification)
        if (email && vaultType === 'fast') {
          console.log('\n📧 Email verification may be required')
          console.log(`   Check your email (${email}) for verification code`)

          // Wait for verification code
          const { default: inquirer } = await import('inquirer')
          const { code } = await inquirer.prompt([
            {
              type: 'input',
              name: 'code',
              message:
                'Enter verification code from email (or press Enter to skip):',
              validate: (_input: string) => {
                // Allow empty input to skip verification
                return true
              },
            },
          ])

          if (code && code.trim()) {
            console.log('🔄 Verifying email code...')
            try {
              const verified = await sdk.verifyVault(vaultId, code.trim())
              if (verified) {
                console.log('✅ Email verification successful!')
                console.log('   Your fast vault is now fully activated')
              } else {
                console.log('❌ Verification failed - invalid code')
                console.log('   The vault was created but not verified')
                console.log(
                  '💡 You can verify later using: vultisig verify --vault-id ' +
                    vaultId
                )
              }
            } catch (error) {
              console.error('❌ Verification failed:', (error as Error).message)
              console.error('   The vault was created but not verified')
              console.error(
                '💡 You can verify later using: vultisig verify --vault-id ' +
                  vaultId
              )
            }
          } else {
            console.log('⏭️  Skipping email verification')
            console.log(
              '💡 You can verify later using: vultisig verify --vault-id ' +
                vaultId
            )
          }
        }
      } else {
        // For secure vaults
        console.log('✅ Secure vault created successfully!')
        console.log(`   Name: ${vault.name}`)
        console.log(`   Type: ${vaultType} (${vault.signers.length} signers)`)
        console.log(`   Encrypted: ${password ? 'Yes' : 'No'}`)
      }

      // Save vault to file
      await this.saveVaultFile(vault, options.name, password)

      // Show vault summary
      console.log('\n📋 Vault Summary:')
      console.log(`   ECDSA Public Key: ${vault.publicKeys.ecdsa}`)
      console.log(`   EdDSA Public Key: ${vault.publicKeys.eddsa}`)
      console.log(`   Local Party ID: ${vault.localPartyId}`)
      console.log(`   Created: ${new Date(vault.createdAt).toLocaleString()}`)
    } catch (error) {
      console.error('❌ Failed to create vault:', error.message)

      if (
        error.cause?.code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' ||
        error.message.includes('certificate') ||
        error.message.includes('SSL') ||
        error.message.includes('TLS')
      ) {
        console.error('\n🔐 SSL Certificate Verification Failed')
        console.error('\n💡 This usually happens because:')
        console.error(
          '   - Corporate proxy/firewall intercepting HTTPS traffic'
        )
        console.error('   - Outdated system CA certificates')
        console.error(
          '   - VPN or antivirus software interfering with connections'
        )
        console.error('\n🔧 Solutions:')
        console.error('   1. TEMPORARY (for testing only):')
        console.error(
          '      NODE_TLS_REJECT_UNAUTHORIZED=0 vultisig create ...'
        )
        console.error('   2. RECOMMENDED (permanent fix):')
        console.error('      - Update your system CA certificates')
        console.error('      - macOS: brew install ca-certificates')
        console.error(
          '      - Or contact your IT department about SSL inspection'
        )
      } else if (
        error.message.includes('Method Not Allowed') ||
        error.message.includes('Internal Server Error')
      ) {
        console.error('💡 Server issue detected. This might be temporary.')
        console.error('   - Check if VultiServer is online')
        console.error('   - Try again in a few minutes')
        console.error('   - Contact support if issue persists')
      } else if (error.message.includes('Password is required')) {
        console.error(
          '💡 Please provide a strong password for vault encryption'
        )
      } else if (error.message.includes('Email is required')) {
        console.error(
          '💡 Email is needed for fast vault verification and recovery'
        )
      } else if (error.message.includes('User force closed')) {
        // User interrupted the prompt - this is normal, don't show error guidance
        return
      } else {
        console.error('💡 Troubleshooting:')
        console.error('   - Check your internet connection')
        console.error('   - Ensure password meets requirements')
        console.error('   - Verify email address is valid')
      }
    }
  }

  private async saveVaultFile(
    vault: any,
    name: string,
    password?: string
  ): Promise<void> {
    try {
      const { getVaultsDir } = await import('../utils/paths')
      const path = await import('path')
      const fs = await import('fs')

      // Ensure vaults directory exists
      const vaultsDir = getVaultsDir()
      if (!fs.existsSync(vaultsDir)) {
        fs.mkdirSync(vaultsDir, { recursive: true })
      }

      // Generate safe filename
      const safeFileName = name
        .replace(/[^a-zA-Z0-9\s-_]/g, '')
        .replace(/\s+/g, '_')
      const fileName = `${safeFileName}.vult`
      const filePath = path.join(vaultsDir, fileName)

      // Export vault
      const vaultBlob = await vault.export(password)
      const buffer = await vaultBlob.arrayBuffer()

      // Save to file
      fs.writeFileSync(filePath, new Uint8Array(buffer))

      console.log(`💾 Vault saved to: ${filePath}`)
    } catch (error) {
      console.error('⚠️  Failed to save vault file:', error.message)
      console.error('   Vault was created but not saved locally')
    }
  }
}
