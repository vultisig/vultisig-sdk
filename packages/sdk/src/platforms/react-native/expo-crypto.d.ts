declare module 'expo-crypto' {
  export function randomUUID(): string
  export function getRandomValues<T extends ArrayBufferView | null>(array: T): T
}
