import { Buffer } from 'buffer'

export const fromBase64 = (value: string): Buffer =>
  Buffer.from(value, 'base64')
