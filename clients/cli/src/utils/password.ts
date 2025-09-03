import inquirer from 'inquirer'
import { VaultLoader } from '../vault/VaultLoader'

export async function promptForPassword(prompt: string, attempt: number, total: number): Promise<string> {
  const answer = await inquirer.prompt([
    {
      type: 'password',
      name: 'password',
      message: `${prompt} (attempt ${attempt}/${total}):`
    }
  ])
  
  return answer.password
}

export async function promptForPasswordWithValidation(
  filePath: string,
  maxAttempts: number = 3
): Promise<string> {
  const vaultLoader = new VaultLoader()
  
  console.log('🔐 Vault is encrypted. Password required.')
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const password = await promptForPassword('Enter password', attempt, maxAttempts)
      
      if (!password.trim()) {
        if (attempt < maxAttempts) {
          console.log('Password cannot be empty. Please try again.')
        }
        continue
      }
      
      // Test the password by trying to load the vault
      await vaultLoader.loadVaultFromFile(filePath, password)
      console.log('✅ Password accepted.')
      return password
      
    } catch (error) {
      if (attempt < maxAttempts) {
        console.log('❌ Incorrect password. Please try again.')
      } else {
        console.log('❌ Incorrect password. Maximum attempts reached.')
      }
    }
  }
  
  throw new Error('Authentication failed after 3 attempts')
}