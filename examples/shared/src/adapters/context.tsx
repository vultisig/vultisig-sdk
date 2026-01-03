import { createContext, type ReactNode,useContext } from 'react'

import type { IFileAdapter, ISDKAdapter } from './types'

// SDK Adapter Context
const SDKAdapterContext = createContext<ISDKAdapter | null>(null)

// File Adapter Context
const FileAdapterContext = createContext<IFileAdapter | null>(null)

/**
 * Hook to access the SDK adapter
 * @throws Error if used outside of AdapterProvider
 */
export function useSDKAdapter(): ISDKAdapter {
  const adapter = useContext(SDKAdapterContext)
  if (!adapter) {
    throw new Error('useSDKAdapter must be used within an AdapterProvider')
  }
  return adapter
}

/**
 * Hook to access the file adapter
 * @throws Error if used outside of AdapterProvider
 */
export function useFileAdapter(): IFileAdapter {
  const adapter = useContext(FileAdapterContext)
  if (!adapter) {
    throw new Error('useFileAdapter must be used within an AdapterProvider')
  }
  return adapter
}

/**
 * Props for the AdapterProvider component
 */
type AdapterProviderProps = {
  sdk: ISDKAdapter
  file: IFileAdapter
  children: ReactNode
}

/**
 * Provider component that makes SDK and File adapters available to all children
 */
export function AdapterProvider({ sdk, file, children }: AdapterProviderProps) {
  return (
    <SDKAdapterContext.Provider value={sdk}>
      <FileAdapterContext.Provider value={file}>{children}</FileAdapterContext.Provider>
    </SDKAdapterContext.Provider>
  )
}

// Export context for advanced use cases
export { FileAdapterContext,SDKAdapterContext }
