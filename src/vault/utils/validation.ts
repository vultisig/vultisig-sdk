import { validateEmail } from '@lib/utils/validation/validateEmail'
import { passwordLenghtConfig } from '@core/ui/security/password/config'
import type { ValidationResult } from '../../types'

/**
 * Validation utilities for SDK input validation
 */
export class ValidationHelpers {
  /**
   * Validate email address format
   * @param email Email address to validate
   * @returns ValidationResult with validity and error message if invalid
   */
  static validateEmail(email: string): ValidationResult {
    const error = validateEmail(email)
    return {
      valid: !error,
      error
    }
  }

  /**
   * Validate password strength and requirements
   * @param password Password to validate
   * @returns ValidationResult with validity and error message if invalid
   */
  static validatePassword(password: string): ValidationResult {
    if (!password) {
      return {
        valid: false,
        error: 'Password is required'
      }
    }

    if (password.length < passwordLenghtConfig.min) {
      return {
        valid: false,
        error: `Password must be at least ${passwordLenghtConfig.min} character${passwordLenghtConfig.min === 1 ? '' : 's'} long`
      }
    }

    if (password.length > passwordLenghtConfig.max) {
      return {
        valid: false,
        error: `Password must be no more than ${passwordLenghtConfig.max} characters long`
      }
    }

    return { valid: true }
  }

  /**
   * Validate vault name format and requirements
   * @param name Vault name to validate
   * @returns ValidationResult with validity and error message if invalid
   */
  static validateVaultName(name: string): ValidationResult {
    if (!name) {
      return {
        valid: false,
        error: 'Vault name is required'
      }
    }

    if (typeof name !== 'string') {
      return {
        valid: false,
        error: 'Vault name must be a string'
      }
    }

    const trimmedName = name.trim()
    
    if (trimmedName.length < 2) {
      return {
        valid: false,
        error: 'Vault name must be at least 2 characters long'
      }
    }

    if (trimmedName.length > 50) {
      return {
        valid: false,
        error: 'Vault name must be no more than 50 characters long'
      }
    }

    return { valid: true }
  }
}
