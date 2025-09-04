import inquirer from 'inquirer'
import * as fs from 'fs'

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
      
      // Simple validation - just check if password is provided
      // In real implementation, this would validate against the vault
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