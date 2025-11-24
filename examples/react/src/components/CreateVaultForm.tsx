import { useMemo, useState } from 'react'
import { Vault, Vultisig } from 'vultisig-sdk'

type CreateVaultFormProps = {
  sdk: Vultisig
  onVaultCreated: (vault: Vault, options?: { serverVerified?: boolean }) => void
  onInitialize: () => Promise<void>
  saveVaultImmediately?: (vault: Vault) => Promise<void>
}

type CreateStep = 'form' | 'creating' | 'verify' | 'verifying' | 'done' | 'error'

export const CreateVaultForm = ({ sdk, onVaultCreated, onInitialize, saveVaultImmediately }: CreateVaultFormProps) => {
  const [createForm, setCreateForm] = useState({
    name: import.meta.env.VITE_VAULT_NAME || 'TestVault',
    email: import.meta.env.VITE_VAULT_EMAIL || 'cryptoforlyfe@gmail.com',
    password: import.meta.env.VITE_VAULT_PASSWORD || 'Password123!',
  })
  const [verificationCode, setVerificationCode] = useState('')
  const [step, setStep] = useState<CreateStep>('form')
  const [error, setError] = useState<string | null>(null)
  const [vaultId, setVaultId] = useState<string>('')
  const [vault, setVault] = useState<Vault | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [keygenProgress, setKeygenProgress] = useState<{
    phase: 'prepare' | 'ecdsa' | 'eddsa' | 'complete'
    round?: number
  } | null>(null)

  const now = useMemo(() => () => new Date().toLocaleTimeString(), [])
  const addLog = (msg: string) => {
    const line = `[${now()}] ${msg}`

    console.info(line)
    setLogs(prev => [...prev, line])
  }

  const handleCreate = async () => {
    try {
      setError(null)
      setStep('creating')
      addLog('Step 1: Registering vault with FastVault server (POST /vault/create)')

      // Initialize WASM modules if not already done
      await onInitialize()

      const { name, email, password } = createForm
      if (!name || !email || !password) return

      // Listen to vault creation progress events
      const progressHandler = ({ step }: { step: any }) => {
        addLog(step.message || `${step.step}: ${step.progress}%`)
        // Map VaultCreationStep to KeygenProgressUpdate phase for UI compatibility
        if (step.step === 'keygen') {
          setKeygenProgress({
            phase: 'ecdsa',
            round: Math.floor(step.progress / 10),
          })
        } else if (step.step === 'complete') {
          setKeygenProgress({ phase: 'complete' })
        }
      }

      sdk.on('vaultCreationProgress', progressHandler)

      try {
        // Use the simplified SDK method that handles the complete 3-step flow
        const result = await sdk.createFastVault({
          name,
          email,
          password,
        })

        addLog('Step 1: FastVault create request completed (200 OK)')
        addLog('Steps 2–4: Server joins relay and runs DKLS/Schnorr keygen on your behalf')
        addLog('Awaiting email to confirm keygen completion and vault activation')

        // Store vault and vault ID for verification
        setVault(result.vault)
        setVaultId(result.vaultId)
      } finally {
        // Clean up event listener
        sdk.off('vaultCreationProgress', progressHandler)
      }

      // Save the vault to storage immediately if a save function is provided
      // This ensures the 1of2 client share is saved locally
      if (saveVaultImmediately) {
        try {
          await saveVaultImmediately(result.vault)
          addLog('Vault keyshare saved locally')
        } catch (error) {
          console.error('Failed to save vault immediately:', error)
          addLog('Warning: Failed to save vault locally - continue with verification')
        }
      }

      // Move to verification step
      setStep('verify')
    } catch (e) {
      const m = (e as Error).message
      setError(m)
      addLog(`Error during Step 1: ${m}`)
      setStep('error')
    }
  }

  const onVerifyEmail = async () => {
    try {
      setError(null)
      setStep('verifying')
      addLog('Step 5: Verifying email code (GET /vault/verify/{vaultId}/{code})')

      // Verify the email code
      const verified = await sdk.verifyVault(vaultId, verificationCode)

      if (verified) {
        addLog('Step 5: Verification succeeded (200 OK)')

        // The vault we already have from createFastVault contains the client's keyShares
        // We don't need to fetch from server as that returns the server's view without keyShares
        // Just mark the existing vault as verified
        if (vault) {
          addLog('Step 6: Using locally created vault with keyshares')
          onVaultCreated(vault, { serverVerified: true })
          setStep('done')
        } else {
          // This shouldn't happen, but as a fallback try to get the vault
          addLog('Warning: No local vault found, attempting to retrieve from server')
          try {
            const fetched = await sdk.getVault(vaultId, createForm.password)
            addLog('Step 6: Vault retrieved from server (may lack keyshares)')
            onVaultCreated(fetched, { serverVerified: true })
            setVault(fetched)
            setStep('done')
          } catch (err) {
            const m = (err as Error).message
            addLog(`Step 6: Failed to retrieve vault: ${m}`)
            setError(m)
            setStep('error')
          }
        }
      } else {
        setError('Invalid verification code')
        addLog('Step 5: Verification failed (invalid code)')
        setStep('verify')
      }
    } catch (e) {
      const m = (e as Error).message
      setError(m)
      addLog(`Error during Step 5: ${m}`)
      setStep('verify')
    }
  }

  const onResendEmail = async () => {
    try {
      // TODO: Add resend verification method to SDK
      // await sdk.resendVaultVerification(vaultId)
      // For now, just show a message
      addLog('Resend email functionality not yet implemented')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const onBackToForm = () => {
    setStep('form')
    setError(null)
    setVault(null)
    setVaultId('')
    setVerificationCode('')
  }

  const renderForm = () => (
    <div style={{ padding: '20px' }}>
      <h2 style={{ margin: '0 0 20px 0', color: '#333' }}>Create Fast Vault</h2>

      <div style={{ marginBottom: '16px' }}>
        <label htmlFor="vault-name" style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
          Vault Name
        </label>
        <input
          id="vault-name"
          type="text"
          placeholder={import.meta.env.VITE_VAULT_NAME || 'My Vault'}
          value={createForm.name}
          onChange={e => setCreateForm(prev => ({ ...prev, name: e.target.value }))}
          style={{
            width: '100%',
            padding: '10px',
            borderRadius: '6px',
            border: '1px solid #e9ecef',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label htmlFor="email" style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
          Email
        </label>
        <input
          id="email"
          type="email"
          placeholder={import.meta.env.VITE_VAULT_EMAIL || 'your@email.com'}
          value={createForm.email}
          onChange={e => setCreateForm(prev => ({ ...prev, email: e.target.value }))}
          style={{
            width: '100%',
            padding: '10px',
            borderRadius: '6px',
            border: '1px solid #e9ecef',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div style={{ marginBottom: '16px' }}>
        <label htmlFor="password" style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
          Password
        </label>
        <input
          id="password"
          type="password"
          placeholder={import.meta.env.VITE_VAULT_PASSWORD || 'Enter a strong password'}
          value={createForm.password}
          onChange={e => setCreateForm(prev => ({ ...prev, password: e.target.value }))}
          style={{
            width: '100%',
            padding: '10px',
            borderRadius: '6px',
            border: '1px solid #e9ecef',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <button
        onClick={handleCreate}
        disabled={!createForm.name || !createForm.email || !createForm.password}
        style={{
          width: '100%',
          padding: '12px',
          backgroundColor: '#007bff',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '16px',
          fontWeight: '500',
        }}
      >
        Create Fast Vault
      </button>
    </div>
  )

  const renderVerification = () => (
    <div style={{ padding: '20px' }}>
      <h2 style={{ margin: '0 0 20px 0', color: '#333' }}>Verify Email</h2>

      <p style={{ margin: '0 0 20px 0', color: '#666', lineHeight: 1.5 }}>
        We&apos;ve sent a verification code to <strong>{createForm.email}</strong>. Please enter the code below to
        complete vault creation.
      </p>

      <div style={{ marginBottom: '16px' }}>
        <label htmlFor="verification-code" style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>
          Verification Code
        </label>
        <input
          id="verification-code"
          type="text"
          placeholder="0000"
          value={verificationCode}
          onChange={e => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
          maxLength={4}
          style={{
            width: '100%',
            padding: '10px',
            borderRadius: '6px',
            border: '1px solid #e9ecef',
            boxSizing: 'border-box',
            textAlign: 'center',
            fontSize: '18px',
            letterSpacing: '4px',
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button
          onClick={onVerifyEmail}
          disabled={verificationCode.length !== 4}
          style={{
            flex: 1,
            padding: '12px',
            backgroundColor: verificationCode.length === 4 ? '#28a745' : '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          Verify
        </button>
        <button
          onClick={onResendEmail}
          style={{
            padding: '12px 16px',
            backgroundColor: '#ffc107',
            color: '#212529',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          Resend
        </button>
      </div>

      <button
        onClick={onBackToForm}
        style={{
          width: '100%',
          padding: '10px',
          backgroundColor: '#6c757d',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
        }}
      >
        Back to Form
      </button>
    </div>
  )

  const renderStatus = () => {
    switch (step) {
      case 'creating':
        return (
          <div style={{ padding: '20px', textAlign: 'center' }}>
            <div style={{ marginBottom: '16px' }}>Creating vault...</div>
            <div style={{ color: '#666', fontSize: '14px' }}>
              This may take a few moments as we initialize WASM modules and run the MPC protocol.
            </div>
            {renderProgress()}
          </div>
        )

      case 'verifying':
        return (
          <div style={{ padding: '20px', textAlign: 'center' }}>
            <div style={{ marginBottom: '16px', color: '#666' }}>Verifying code...</div>
            {renderProgress()}
          </div>
        )

      case 'done':
        return (
          <div
            style={{
              padding: '20px',
              textAlign: 'center',
              backgroundColor: '#d4edda',
              border: '1px solid #c3e6cb',
              borderRadius: '6px',
              color: '#155724',
            }}
          >
            <h3 style={{ margin: '0 0 10px 0' }}>Vault Created Successfully!</h3>
            <p style={{ margin: 0 }}>Your fast vault is ready to use.</p>
            {renderProgress()}
          </div>
        )

      case 'error':
        return (
          <div style={{ padding: '20px' }}>
            <div
              style={{
                padding: '16px',
                backgroundColor: '#f8d7da',
                border: '1px solid #f5c6cb',
                borderRadius: '6px',
                color: '#721c24',
                marginBottom: '16px',
              }}
            >
              <strong>Error:</strong> {error}
            </div>
            <button
              onClick={onBackToForm}
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              Try Again
            </button>
          </div>
        )

      default:
        return null
    }
  }

  const renderProgress = () => {
    const stages = [
      { key: 'create', label: 'Submit create request to VultiServer' },
      { key: 'prepare', label: 'Prepare keygen' },
      {
        key: 'ecdsa',
        label: `ECDSA keygen${keygenProgress?.phase === 'ecdsa' && keygenProgress?.round ? ` (round ${keygenProgress.round})` : ''}`,
      },
      {
        key: 'eddsa',
        label: `EdDSA keygen${keygenProgress?.phase === 'eddsa' && keygenProgress?.round ? ` (round ${keygenProgress.round})` : ''}`,
      },
      { key: 'email', label: 'Email verification code sent' },
      { key: 'verify', label: 'Verify code' },
      { key: 'ready', label: 'Vault ready' },
    ] as const

    const isDone = (k: string) => {
      switch (k) {
        case 'create':
          return step !== 'form'
        case 'prepare':
          return (
            keygenProgress?.phase === 'ecdsa' ||
            keygenProgress?.phase === 'eddsa' ||
            keygenProgress?.phase === 'complete' ||
            step === 'verify' ||
            step === 'verifying' ||
            step === 'done' ||
            step === 'error'
          )
        case 'ecdsa':
          return (
            keygenProgress?.phase === 'eddsa' ||
            keygenProgress?.phase === 'complete' ||
            step === 'verify' ||
            step === 'verifying' ||
            step === 'done' ||
            step === 'error'
          )
        case 'eddsa':
          return (
            keygenProgress?.phase === 'complete' ||
            step === 'verify' ||
            step === 'verifying' ||
            step === 'done' ||
            step === 'error'
          )
        case 'email':
          return step === 'verify' || step === 'verifying' || step === 'done' || step === 'error'
        case 'verify':
          return step === 'done'
        case 'ready':
          return step === 'done'
        default:
          return false
      }
    }

    const isActive = (k: string) => {
      switch (k) {
        case 'create':
          return step === 'creating' && (!keygenProgress || keygenProgress.phase === 'prepare')
        case 'prepare':
          return step === 'creating' && keygenProgress?.phase === 'prepare'
        case 'ecdsa':
          return step === 'creating' && keygenProgress?.phase === 'ecdsa'
        case 'eddsa':
          return step === 'creating' && keygenProgress?.phase === 'eddsa'
        case 'email':
          return step === 'verify'
        case 'verify':
          return step === 'verifying'
        case 'ready':
          return step === 'done'
        default:
          return false
      }
    }

    return (
      <div style={{ marginTop: 16, textAlign: 'left' }}>
        {stages.map((s, idx) => (
          <div
            key={s.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 8,
            }}
          >
            <span
              aria-hidden
              style={{
                display: 'inline-flex',
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: isDone(s.key) ? '#28a745' : isActive(s.key) ? '#ffc107' : '#e9ecef',
                border: '1px solid #ced4da',
              }}
            />
            <span
              style={{
                color: isDone(s.key) ? '#155724' : isActive(s.key) ? '#856404' : '#6c757d',
              }}
            >
              {idx + 1}. {s.label}
            </span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div
      style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        maxWidth: '500px',
        margin: '0 auto',
      }}
    >
      {step === 'form' && renderForm()}
      {step === 'verify' && renderVerification()}
      {(step === 'creating' || step === 'verifying' || step === 'done' || step === 'error') && renderStatus()}
      {!!logs.length && (
        <div style={{ padding: '16px', borderTop: '1px solid #e9ecef' }}>
          <div style={{ marginBottom: 8, fontWeight: 600, color: '#333' }}>Debug Log</div>
          <div
            style={{
              maxHeight: 200,
              overflowY: 'auto',
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 12,
              color: '#495057',
              background: '#f8f9fa',
              border: '1px solid #e9ecef',
              borderRadius: 6,
              padding: 8,
            }}
          >
            {logs.map((l, i) => (
              <div key={i} style={{ whiteSpace: 'pre-wrap' }}>
                {l}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
