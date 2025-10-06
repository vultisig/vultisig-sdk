// Local types for the react2 example

export type LoadedKeyshare = {
  id: string
  name: string
  size: number // File size in bytes
  encrypted: boolean // Whether the vault is encrypted
  data: any // Will contain the vault data (null until loaded)
  file?: File | null // Original file reference if loaded from file
  containerBase64?: string // Base64 encoded vault container content
}
