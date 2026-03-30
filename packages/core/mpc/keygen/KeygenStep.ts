export const keygenSteps = [
  'prepareVault',
  'ecdsa',
  'eddsa',
  'mldsa',
  'chainKeys',
] as const

export type KeygenStep = (typeof keygenSteps)[number]
