import { dialog, type IpcMain } from 'electron'
import * as fs from 'fs/promises'

import { getSDK, getSDKModule, rejectPasswordRequest, resolvePasswordRequest } from './sdk'

export function registerIpcHandlers(ipcMain: IpcMain): void {
  // === SDK LIFECYCLE ===

  ipcMain.handle('sdk:initialize', async () => {
    const sdk = getSDK()
    return { initialized: sdk.initialized }
  })

  ipcMain.handle('sdk:getServerStatus', async () => {
    const sdk = getSDK()
    return sdk.getServerStatus()
  })

  // === VAULT MANAGEMENT ===

  ipcMain.handle('vault:list', async () => {
    const sdk = getSDK()
    const vaults = await sdk.listVaults()
    // Return serializable vault data
    return vaults.map(vault => ({
      id: vault.id,
      name: vault.name,
      type: vault.type,
      chains: vault.chains,
      threshold: vault.threshold,
      signerCount: vault.signers.length,
    }))
  })

  ipcMain.handle(
    'vault:createFast',
    async (
      _event,
      options: {
        name: string
        password: string
        email: string
      }
    ) => {
      const sdk = getSDK()
      const vaultId = await sdk.createFastVault({
        ...options,
        onProgress: step => {
          _event.sender.send('vault:creationProgress', { step })
        },
      })
      return { vaultId }
    }
  )

  ipcMain.handle('vault:verify', async (_event, vaultId: string, code: string) => {
    const sdk = getSDK()
    const vault = await sdk.verifyVault(vaultId, code)
    return {
      id: vault.id,
      name: vault.name,
      type: vault.type,
      chains: vault.chains,
    }
  })

  ipcMain.handle(
    'vault:resendVerification',
    async (_event, options: { vaultId: string; email: string; password: string }) => {
      const sdk = getSDK()
      await sdk.resendVaultVerification(options)
    }
  )

  ipcMain.handle(
    'vault:createSecure',
    async (
      _event,
      options: {
        name: string
        password?: string
        devices: number
        threshold?: number
      }
    ) => {
      const sdk = getSDK()

      const result = await sdk.createSecureVault({
        name: options.name,
        password: options.password || '',
        devices: options.devices,
        threshold: options.threshold,
        onProgress: step => {
          _event.sender.send('vault:creationProgress', { step })
        },
        onQRCodeReady: qrPayload => {
          _event.sender.send('vault:qrCodeReady', { qrPayload })
        },
        onDeviceJoined: (deviceId, totalJoined, required) => {
          _event.sender.send('vault:deviceJoined', { deviceId, totalJoined, required })
        },
      })

      return {
        vault: {
          id: result.vault.id,
          name: result.vault.name,
          type: result.vault.type,
          chains: result.vault.chains,
          threshold: result.vault.threshold,
          signerCount: result.vault.signers.length,
        },
        sessionId: result.sessionId,
      }
    }
  )

  ipcMain.handle('vault:import', async (_event, vultContent: string, password?: string) => {
    const sdk = getSDK()
    const vault = await sdk.importVault(vultContent, password)
    return {
      id: vault.id,
      name: vault.name,
      type: vault.type,
      chains: vault.chains,
      threshold: vault.threshold,
      signerCount: vault.signers.length,
    }
  })

  ipcMain.handle('vault:isEncrypted', async (_event, vultContent: string) => {
    const sdk = getSDK()
    return sdk.isVaultEncrypted(vultContent)
  })

  ipcMain.handle('vault:delete', async (_event, vaultId: string) => {
    const sdk = getSDK()
    const vault = await sdk.getVaultById(vaultId)
    if (vault) {
      await sdk.deleteVault(vault)
    }
  })

  ipcMain.handle('vault:setActive', async (_event, vaultId: string | null) => {
    const sdk = getSDK()
    if (vaultId) {
      const vault = await sdk.getVaultById(vaultId)
      if (!vault) throw new Error('Vault not found')
      await sdk.setActiveVault(vault)
      _event.sender.send('vault:changed', {
        vault: {
          id: vault.id,
          name: vault.name,
          type: vault.type,
          chains: vault.chains,
          threshold: vault.threshold,
          signerCount: vault.signers.length,
        },
      })
    } else {
      await sdk.setActiveVault(null)
      _event.sender.send('vault:changed', { vault: null })
    }
  })

  ipcMain.handle('vault:getActive', async () => {
    const sdk = getSDK()
    const vault = await sdk.getActiveVault()
    if (!vault) return null
    return {
      id: vault.id,
      name: vault.name,
      type: vault.type,
      chains: vault.chains,
      threshold: vault.threshold,
      signerCount: vault.signers.length,
    }
  })

  // === VAULT OPERATIONS ===

  ipcMain.handle('vault:getAddress', async (_event, vaultId: string, chain: string) => {
    const sdk = getSDK()
    const vault = await sdk.getVaultById(vaultId)
    if (!vault) throw new Error('Vault not found')
    return await vault.address(chain as any)
  })

  ipcMain.handle('vault:getAllAddresses', async (_event, vaultId: string) => {
    const sdk = getSDK()
    const vault = await sdk.getVaultById(vaultId)
    if (!vault) throw new Error('Vault not found')

    const addresses: Record<string, string> = {}
    for (const chain of vault.chains) {
      try {
        addresses[chain] = await vault.address(chain)
      } catch {
        // Skip chains that fail
      }
    }
    return addresses
  })

  ipcMain.handle('vault:getBalance', async (_event, vaultId: string, chain: string, tokenId?: string) => {
    const sdk = getSDK()
    const vault = await sdk.getVaultById(vaultId)
    if (!vault) throw new Error('Vault not found')
    const balance = await vault.balance(chain as any, tokenId)
    _event.sender.send('vault:balanceUpdated', { chain, tokenId })
    return {
      amount: balance.amount,
      decimals: balance.decimals,
      symbol: balance.symbol,
      value: balance.fiatValue,
    }
  })

  ipcMain.handle('vault:getChains', async (_event, vaultId: string) => {
    const sdk = getSDK()
    const vault = await sdk.getVaultById(vaultId)
    if (!vault) throw new Error('Vault not found')
    return vault.chains
  })

  ipcMain.handle('vault:addChain', async (_event, vaultId: string, chain: string) => {
    const sdk = getSDK()
    const vault = await sdk.getVaultById(vaultId)
    if (!vault) throw new Error('Vault not found')
    await vault.addChain(chain as any)
    _event.sender.send('vault:chainChanged', { chain, action: 'added' })
  })

  ipcMain.handle('vault:removeChain', async (_event, vaultId: string, chain: string) => {
    const sdk = getSDK()
    const vault = await sdk.getVaultById(vaultId)
    if (!vault) throw new Error('Vault not found')
    await vault.removeChain(chain as any)
    _event.sender.send('vault:chainChanged', { chain, action: 'removed' })
  })

  ipcMain.handle('vault:getTokens', async (_event, vaultId: string, chain: string) => {
    const sdk = getSDK()
    const vault = await sdk.getVaultById(vaultId)
    if (!vault) throw new Error('Vault not found')
    return vault.getTokens(chain as any)
  })

  ipcMain.handle('vault:addToken', async (_event, vaultId: string, chain: string, token: any) => {
    const sdk = getSDK()
    const vault = await sdk.getVaultById(vaultId)
    if (!vault) throw new Error('Vault not found')
    await vault.addToken(chain as any, token)
  })

  ipcMain.handle('vault:removeToken', async (_event, vaultId: string, chain: string, tokenId: string) => {
    const sdk = getSDK()
    const vault = await sdk.getVaultById(vaultId)
    if (!vault) throw new Error('Vault not found')
    await vault.removeToken(chain as any, tokenId)
  })

  // === PORTFOLIO OPERATIONS ===

  ipcMain.handle('vault:setCurrency', async (_event, vaultId: string, currency: string) => {
    const sdk = getSDK()
    const vault = await sdk.getVaultById(vaultId)
    if (!vault) throw new Error('Vault not found')
    vault.setCurrency(currency as any)
  })

  ipcMain.handle(
    'vault:getValue',
    async (_event, vaultId: string, chain: string, tokenId?: string, currency?: string) => {
      const sdk = getSDK()
      const vault = await sdk.getVaultById(vaultId)
      if (!vault) throw new Error('Vault not found')
      if (currency) vault.setCurrency(currency as any)
      const value = await vault.getValue(chain as any, tokenId, currency as any)
      return { amount: value.amount, currency: value.currency || currency || 'usd' }
    }
  )

  ipcMain.handle('vault:getTotalValue', async (_event, vaultId: string, currency?: string) => {
    const sdk = getSDK()
    const vault = await sdk.getVaultById(vaultId)
    if (!vault) throw new Error('Vault not found')
    if (currency) vault.setCurrency(currency as any)
    const value = await vault.getTotalValue(currency as any)
    return { amount: value.amount, currency: value.currency || currency || 'usd' }
  })

  // === SWAP OPERATIONS ===

  ipcMain.handle('vault:getSupportedSwapChains', async () => {
    const sdk = getSDK()
    return (sdk as any).getSupportedSwapChains?.() || []
  })

  ipcMain.handle('vault:isSwapSupported', async (_event, fromChain: string, toChain: string) => {
    const sdk = getSDK()
    return (sdk as any).isSwapSupported?.(fromChain, toChain) || false
  })

  ipcMain.handle('vault:getSwapQuote', async (_event, vaultId: string, params: any) => {
    const sdk = getSDK()
    const vault = await sdk.getVaultById(vaultId)
    if (!vault) throw new Error('Vault not found')
    const quote = await vault.getSwapQuote(params)
    // Serialize for IPC (convert BigInt to string)
    return JSON.parse(JSON.stringify(quote, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)))
  })

  ipcMain.handle('vault:prepareSwapTx', async (_event, vaultId: string, params: any) => {
    const sdk = getSDK()
    const vault = await sdk.getVaultById(vaultId)
    if (!vault) throw new Error('Vault not found')
    const result = await vault.prepareSwapTx(params)
    // Serialize for IPC (convert BigInt to string)
    return JSON.parse(JSON.stringify(result, (_key, value) => (typeof value === 'bigint' ? value.toString() : value)))
  })

  // === TRANSACTION OPERATIONS ===

  ipcMain.handle(
    'vault:prepareSendTx',
    async (
      _event,
      vaultId: string,
      params: {
        coin: any
        receiver: string
        amount: string
        memo?: string
      }
    ) => {
      const sdk = getSDK()
      const vault = await sdk.getVaultById(vaultId)
      if (!vault) throw new Error('Vault not found')

      const keysignPayload = await vault.prepareSendTx({
        ...params,
        amount: BigInt(params.amount),
      })

      // Serialize payload for IPC (convert BigInt to string)
      return JSON.parse(
        JSON.stringify(keysignPayload, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))
      )
    }
  )

  ipcMain.handle('vault:extractMessageHashes', async (_event, vaultId: string, keysignPayload: any) => {
    const sdk = getSDK()
    const vault = await sdk.getVaultById(vaultId)
    if (!vault) throw new Error('Vault not found')
    return vault.extractMessageHashes(keysignPayload)
  })

  ipcMain.handle('vault:sign', async (_event, vaultId: string, keysignPayload: any) => {
    const sdk = getSDK()
    const vault = await sdk.getVaultById(vaultId)
    if (!vault) throw new Error('Vault not found')

    // Subscribe to signing events
    const handleProgress = (data: any) => {
      _event.sender.send('vault:signingProgress', data)
    }
    const handleQrCode = (data: any) => {
      _event.sender.send('vault:qrCodeReady', data)
    }
    const handleDeviceJoined = (data: any) => {
      _event.sender.send('vault:deviceJoined', data)
    }

    vault.on('signingProgress', handleProgress)
    vault.on('qrCodeReady', handleQrCode)
    vault.on('deviceJoined', handleDeviceJoined)

    try {
      const signature = await vault.sign(keysignPayload)
      // Serialize for IPC (convert BigInt to string)
      return JSON.parse(
        JSON.stringify(signature, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))
      )
    } finally {
      vault.off('signingProgress', handleProgress)
      vault.off('qrCodeReady', handleQrCode)
      vault.off('deviceJoined', handleDeviceJoined)
    }
  })

  ipcMain.handle(
    'vault:broadcastTx',
    async (
      _event,
      vaultId: string,
      params: {
        chain: string
        keysignPayload: any
        signature: any
      }
    ) => {
      const sdk = getSDK()
      const vault = await sdk.getVaultById(vaultId)
      if (!vault) throw new Error('Vault not found')
      const txHash = await vault.broadcastTx({
        ...params,
        chain: params.chain as any,
      })
      _event.sender.send('vault:transactionBroadcast', { chain: params.chain, txHash })
      return txHash
    }
  )

  // === EXPORT OPERATIONS ===

  ipcMain.handle(
    'vault:export',
    async (
      _event,
      vaultId: string,
      options?: {
        password?: string
        includeSigners?: boolean
      }
    ) => {
      const sdk = getSDK()
      const vault = await sdk.getVaultById(vaultId)
      if (!vault) throw new Error('Vault not found')
      const result = await vault.export(options?.password)
      // Extract .data to match browser adapter's expected return type
      return result.data
    }
  )

  ipcMain.handle('vault:rename', async (_event, vaultId: string, newName: string) => {
    const sdk = getSDK()
    const vault = await sdk.getVaultById(vaultId)
    if (!vault) throw new Error('Vault not found')
    await vault.rename(newName)
  })

  // === FILE DIALOG ===

  ipcMain.handle(
    'dialog:openFile',
    async (
      _event,
      options: {
        title?: string
        filters?: Array<{ name: string; extensions: string[] }>
        multiSelections?: boolean
      }
    ) => {
      const result = await dialog.showOpenDialog({
        title: options.title || 'Select File',
        filters: options.filters || [{ name: 'Vault Files', extensions: ['vult', 'json'] }],
        properties: options.multiSelections ? ['openFile', 'multiSelections'] : ['openFile'],
      })
      return result
    }
  )

  ipcMain.handle(
    'dialog:saveFile',
    async (
      _event,
      options: {
        title?: string
        defaultPath?: string
        filters?: Array<{ name: string; extensions: string[] }>
      }
    ) => {
      const result = await dialog.showSaveDialog({
        title: options.title || 'Save File',
        defaultPath: options.defaultPath,
        filters: options.filters || [{ name: 'Vault Files', extensions: ['vult'] }],
      })
      return result
    }
  )

  ipcMain.handle('file:read', async (_event, filePath: string) => {
    const content = await fs.readFile(filePath, 'utf-8')
    return content
  })

  ipcMain.handle('file:write', async (_event, filePath: string, content: string) => {
    await fs.writeFile(filePath, content, 'utf-8')
  })

  // === PASSWORD HANDLING ===

  ipcMain.handle('password:resolve', async (_event, requestId: string, password: string) => {
    resolvePasswordRequest(requestId, password)
  })

  ipcMain.handle('password:reject', async (_event, requestId: string) => {
    rejectPasswordRequest(requestId)
  })

  // === STATIC UTILITIES ===

  ipcMain.handle('sdk:getTxExplorerUrl', async (_event, chain: string, txHash: string) => {
    const sdkModule = getSDKModule()
    return sdkModule.Vultisig.getTxExplorerUrl(
      chain as (typeof sdkModule)['Chain'][keyof (typeof sdkModule)['Chain']],
      txHash
    )
  })

  ipcMain.handle('sdk:getChainList', async () => {
    const sdkModule = getSDKModule()
    return Object.values(sdkModule.Chain)
  })
}
