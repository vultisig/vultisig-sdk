import React, { useState } from 'react'
import { Vultisig } from 'vultisig-sdk'

type VaultLike = {
  name: string
  libType?: unknown
  publicKeys?: { ecdsa?: string; eddsa?: string }
  signers?: Array<unknown>
}

type VaultCreatorProps = {
  sdk: Vultisig
  onVaultCreated: (vault: VaultLike) => void
  onInitialize: () => Promise<void>
}

const VaultCreator: React.FC<VaultCreatorProps> = ({ sdk, onVaultCreated, onInitialize }) => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [step, setStep] = useState<'form' | 'creating' | 'verifying'>('form')
  const [vaultId, setVaultId] = useState<string>('')
  const [verificationCode, setVerificationCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isResending, setIsResending] = useState(false)

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Validate form data using SDK utilities
    const nameValidation = Vultisig.validateVaultName(formData.name)
    if (!nameValidation.valid) {
      setError(nameValidation.error!)
      return
    }

    if (Vultisig.validateEmail(formData.email).valid === false) {
      setError('Please enter a valid email address')
      return
    }

    const passwordValidation = Vultisig.validatePassword(formData.password)
    if (!passwordValidation.valid) {
      setError(passwordValidation.error!)
      return
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setStep('creating')

    try {
      console.log('Starting Fast Vault creation with server...')

      // Ensure SDK is initialized before creating vault
      await onInitialize()

      console.log('Vault parameters:', {
        name: formData.name,
        email: formData.email,
        hasPassword: !!formData.password,
        passwordsMatch: formData.password === formData.confirmPassword,
      })

      // Create vault params without confirmPassword
      const vaultParams = {
        name: formData.name,
        email: formData.email,
        password: formData.password,
      }

      // Use SDK for Fast Vault creation with server
      const result = await sdk.createFastVault(vaultParams)
      console.log('Vault creation request successful!')
      console.log('Result:', {
        vaultId: result.vaultId,
        verificationRequired: result.verificationRequired,
        vaultName: (result.vault as any).data?.name || 'Unknown',
      })

      setVaultId(result.vaultId)

      if (result.verificationRequired) {
        console.log('Email verification required - switching to verification step')
        setStep('verifying')
      } else {
        console.log('Vault created successfully without verification needed')
        const vaultData = (result.vault as any).data
        onVaultCreated(vaultData || result.vault)
      }
    } catch (err) {
      console.error('Vault creation failed:', err)
      setError((err as Error).message)
      setStep('form')
    }
  }

  const handleVerification = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    console.log('🔍 VERIFY BUTTON CLICKED!')
    console.log('Form event:', e)
    console.log('Current state:', {
      vaultId,
      verificationCode,
      codeLength: verificationCode.length,
      hasVaultId: !!vaultId,
      hasCode: !!verificationCode,
    })

    if (!verificationCode || !verificationCode.trim()) {
      setError('Please enter the verification code')
      return
    }

    if (!vaultId) {
      setError('Vault ID is missing - please try creating the vault again')
      return
    }

    try {
      console.log('🚀 Starting email verification...')
      console.log('Verification details:', {
        vaultId: vaultId,
        code: verificationCode,
        codeLength: verificationCode.length,
      })

      const verified = await sdk.verifyVault(vaultId, verificationCode)
      console.log('✅ Email verification response:', verified)

      if (!verified) {
        setError('Wrong verification code. Please check your email and try again.')
        return
      }

      console.log('📥 Retrieving complete vault from server...')
      // After verification, retrieve the complete vault
      const vault = await sdk.getVault(vaultId, formData.password)
      const vaultData = (vault as any).data
      console.log('🎉 Vault retrieved successfully!', {
        name: vaultData?.name || 'Unknown',
        libType: vaultData?.libType || 'Unknown',
        hasPublicKeys: !!(vaultData?.publicKeys?.ecdsa && vaultData?.publicKeys?.eddsa),
        signers: vaultData?.signers?.length || 0,
      })

      onVaultCreated(vaultData || vault)
    } catch (err) {
      console.error('❌ Verification failed:', err)
      const errorMessage = (err as Error).message
      if (errorMessage.includes('400') || errorMessage.includes('Bad Request')) {
        setError('Wrong verification code. Please check your email and try again.')
      } else if (errorMessage.includes('404')) {
        setError('Vault not found. Please try creating the vault again.')
      } else {
        setError(`Verification failed: ${errorMessage}`)
      }
    }
  }

  const handleResendCode = async () => {
    if (!vaultId) return

    setIsResending(true)
    setError(null)

    try {
      console.log('🔄 Resending verification email...')
      // TODO: SDK doesn't have resendVaultVerification method yet
      // await sdk.resendVaultVerification(vaultId)
      setError('Resend functionality not yet implemented')
      console.log('⚠️ Resend not implemented in SDK')
    } catch (err) {
      console.error('❌ Failed to resend verification email:', err)
      setError('Failed to resend verification email. Please try again.')
    } finally {
      setIsResending(false)
    }
  }

  if (step === 'creating') {
    return (
      <div
        style={{
          textAlign: 'center',
          padding: '40px',
          backgroundColor: '#f8f9fa',
          borderRadius: '8px',
          border: '1px solid #e9ecef',
        }}
      >
        <div
          style={{
            width: '40px',
            height: '40px',
            border: '4px solid #f3f3f3',
            borderTop: '4px solid #007bff',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 20px',
          }}
        />
        <h3 style={{ color: '#333', marginBottom: '10px' }}>Creating Fast Vault with Server...</h3>
        <p style={{ color: '#666', margin: '0' }}>Server is generating your MPC keyshares</p>
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    )
  }

  if (step === 'verifying') {
    return (
      <div
        style={{
          maxWidth: '400px',
          padding: '30px',
          backgroundColor: '#f8f9fa',
          borderRadius: '8px',
          border: '1px solid #e9ecef',
        }}
      >
        <h3 style={{ color: '#333', marginBottom: '10px' }}>Email Verification Required</h3>
        <p style={{ color: '#666', marginBottom: '20px' }}>Please check your email for a 4-digit verification code.</p>

        <form onSubmit={handleVerification} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <input
            type="text"
            placeholder="Enter 4-digit verification code"
            value={verificationCode}
            onChange={e => setVerificationCode(e.target.value)}
            maxLength={4}
            pattern="[0-9]{4}"
            style={{
              padding: '12px',
              border: '1px solid #ccc',
              borderRadius: '6px',
              fontSize: '14px',
              textAlign: 'center',
              letterSpacing: '0.2em',
            }}
            required
          />

          <button
            type="submit"
            style={{
              padding: '12px',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
            }}
          >
            Verify Email
          </button>

          <button
            type="button"
            onClick={handleResendCode}
            disabled={isResending}
            style={{
              padding: '12px',
              backgroundColor: isResending ? '#6c757d' : '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: isResending ? 'not-allowed' : 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              opacity: isResending ? 0.6 : 1,
            }}
          >
            {isResending ? 'Resending...' : 'Resend Code'}
          </button>

          {error && (
            <div
              style={{
                color: '#dc3545',
                fontSize: '14px',
                padding: '10px',
                backgroundColor: '#f8d7da',
                border: '1px solid #f5c6cb',
                borderRadius: '4px',
              }}
            >
              {error}
            </div>
          )}
        </form>
      </div>
    )
  }

  return (
    <div
      style={{
        maxWidth: '400px',
        padding: '30px',
        backgroundColor: 'white',
        borderRadius: '8px',
        border: '1px solid #e9ecef',
        boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
      }}
    >
      <h2 style={{ color: '#333', marginBottom: '10px' }}>Create Fast Vault (Server-Assisted)</h2>
      <p style={{ color: '#666', marginBottom: '25px' }}>Server will generate MPC keyshares for you</p>

      <form onSubmit={handleFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <input
          type="text"
          placeholder="Vault Name"
          value={formData.name}
          onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
          style={{
            padding: '12px',
            border: '1px solid #ccc',
            borderRadius: '6px',
            fontSize: '14px',
          }}
          required
        />

        <input
          type="email"
          placeholder="Email Address"
          value={formData.email}
          onChange={e => setFormData(prev => ({ ...prev, email: e.target.value }))}
          style={{
            padding: '12px',
            border:
              formData.email && Vultisig.validateEmail(formData.email).valid === false
                ? '1px solid #dc3545'
                : '1px solid #ccc',
            borderRadius: '6px',
            fontSize: '14px',
          }}
          required
        />

        {formData.email && Vultisig.validateEmail(formData.email).valid === false && (
          <div
            style={{
              color: '#dc3545',
              fontSize: '12px',
              marginTop: '-10px',
            }}
          >
            Please enter a valid email address
          </div>
        )}

        <input
          type="password"
          placeholder="Password (minimum 8 characters)"
          value={formData.password}
          onChange={e => setFormData(prev => ({ ...prev, password: e.target.value }))}
          style={{
            padding: '12px',
            border: formData.password && formData.password.length < 8 ? '1px solid #dc3545' : '1px solid #ccc',
            borderRadius: '6px',
            fontSize: '14px',
          }}
          required
          minLength={8}
        />

        {formData.password && formData.password.length < 8 && (
          <div
            style={{
              color: '#dc3545',
              fontSize: '12px',
              marginTop: '-10px',
            }}
          >
            Password must be at least 8 characters long
          </div>
        )}

        <input
          type="password"
          placeholder="Confirm Password"
          value={formData.confirmPassword}
          onChange={e =>
            setFormData(prev => ({
              ...prev,
              confirmPassword: e.target.value,
            }))
          }
          style={{
            padding: '12px',
            border:
              formData.confirmPassword && formData.password !== formData.confirmPassword
                ? '1px solid #dc3545'
                : '1px solid #ccc',
            borderRadius: '6px',
            fontSize: '14px',
          }}
          required
        />

        {formData.confirmPassword && formData.password !== formData.confirmPassword && (
          <div
            style={{
              color: '#dc3545',
              fontSize: '12px',
              marginTop: '-10px',
            }}
          >
            Passwords do not match
          </div>
        )}

        <button
          type="submit"
          style={{
            padding: '14px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500',
          }}
        >
          Create Fast Vault
        </button>

        {error && (
          <div
            style={{
              color: '#dc3545',
              fontSize: '14px',
              padding: '10px',
              backgroundColor: '#f8d7da',
              border: '1px solid #f5c6cb',
              borderRadius: '4px',
            }}
          >
            {error}
          </div>
        )}
      </form>
    </div>
  )
}

export default VaultCreator
