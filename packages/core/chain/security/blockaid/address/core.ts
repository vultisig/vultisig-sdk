export type BlockaidAddressScanResult = {
  resultType: 'Benign' | 'Warning' | 'Malicious'
  features: string[]
}
