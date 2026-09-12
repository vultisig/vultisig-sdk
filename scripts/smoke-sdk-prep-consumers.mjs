import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

// Invoked after installing the tarball. All SDK imports resolve through the
// consumer's package manager, never through workspace aliases or source files.
export async function smokePrepConsumers({ appRoot, repoRoot }) {
  writeFileSync(
    path.join(appRoot, 'prep-runtime.mjs'),
    `
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { bech32 } from 'bech32'
import { runtimeStore } from '@vultisig/mpc-types'
const require = createRequire(import.meta.url)
const load = name => process.argv[2] === 'cjs' ? require(name) : import(name)
let root
if (process.argv[3] === 'root-first') root = await load('@vultisig/sdk')
const before = runtimeStore().walletCore
const prep = await load('@vultisig/sdk/tools/prep')
if (before) assert.equal(runtimeStore().walletCore, before)
const address = bech32.encode('cosmos', bech32.toWords(new Uint8Array(20).fill(1)))
const validator = bech32.encode('cosmosvaloper', bech32.toWords(new Uint8Array(20).fill(2)))
const msg = prep.buildDelegateMsg({delegatorAddress: address, validatorAddress: validator, amount: '123', denom: 'uatom'})
assert.equal(msg.typeUrl, '/cosmos.staking.v1beta1.MsgDelegate')
assert.equal(Buffer.from(msg.valueBase64, 'base64').toString('hex'),
  '0a' + address.length.toString(16) + Buffer.from(address).toString('hex') +
  '12' + validator.length.toString(16) + Buffer.from(validator).toString('hex') + '1a0c0a057561746f6d1203313233')
// Public secp256k1 generator point: no private key or vault is used.
const publicKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
const identity = {ecdsaPublicKey: publicKey, eddsaPublicKey: '00'.repeat(32), hexChainCode: '00'.repeat(32),
  chainPublicKeys: {Cosmos: publicKey}, localPartyId: 'package-consumer', libType: 'DKLS'}
const wallet = await prep.getWalletCore()
const payload = await prep.prepareSignAminoTxFromKeys(identity, {
  chain: 'Cosmos', coin: {chain:'Cosmos', address, decimals:6, ticker:'ATOM'},
  msgs: [{type:'cosmos-sdk/MsgDelegate', value: JSON.stringify({delegator_address:address,validator_address:validator,amount:{denom:'uatom',amount:'123'}})}],
  fee: {amount:[{denom:'uatom',amount:'5000'}],gas:'200000'},
}, {skipChainSpecificFetch:true})
assert.equal(payload.coin.hexPublicKey, publicKey)
assert.equal(payload.vaultLocalPartyId, 'package-consumer')
assert.equal(payload.blockchainSpecific.case, 'cosmosSpecific')
assert.equal(payload.signData.value.fee.gas, '200000')
const getter = runtimeStore().walletCore
root ??= await load('@vultisig/sdk')
assert.equal(runtimeStore().walletCore, getter)
assert.equal(await prep.getWalletCore(), wallet)
assert.deepEqual(root.buildDelegateMsg({delegatorAddress:address,validatorAddress:validator,amount:'123',denom:'uatom'}),msg)
console.log(JSON.stringify({prep:true,format:process.argv[2],order:process.argv[3],walletCore:true,sharedInitialization:true}))
`
  )
  for (const format of ['esm', 'cjs']) {
    for (const order of ['prep-first', 'root-first']) {
      execFileSync(process.execPath, ['prep-runtime.mjs', format, order], { cwd: appRoot, stdio: 'inherit' })
    }
  }
  writeFileSync(
    path.join(appRoot, 'prep-types.cts'),
    `
import { buildDelegateMsg, type DelegateParams, type CosmosStakingMsgEnvelope } from '@vultisig/sdk/tools/prep'
const delegate: (params: DelegateParams) => CosmosStakingMsgEnvelope = buildDelegateMsg
void delegate
`
  )
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/tsc'),
    [
      '--module',
      'Node16',
      '--moduleResolution',
      'Node16',
      '--target',
      'ES2022',
      '--noEmit',
      '--skipLibCheck',
      'prep-types.cts',
    ],
    { cwd: appRoot, stdio: 'inherit' }
  )
  for (const native of [false, true]) {
    writeFileSync(
      path.join(appRoot, 'prep-types.ts'),
      `
import * as prep from '@vultisig/sdk/tools/prep'
type Expected = ${native ? 'Promise<prep.SplTransferResult>' : 'prep.SplTransferResult'}
const spl: (...args: Parameters<typeof prep.buildSplTransfer>) => Expected = prep.buildSplTransfer
const delegate: (params: prep.DelegateParams) => prep.CosmosStakingMsgEnvelope = prep.buildDelegateMsg
const thor: typeof prep.prepareThorchainMsgDepositTxFromKeys = prep.prepareThorchainMsgDepositTxFromKeys
// @ts-expect-error deferred wrappers must retain required canonical arguments
prep.prepareSendTxFromKeys()
void [spl, delegate, thor]
`
    )
    writeFileSync(
      path.join(appRoot, 'prep-tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ES2022',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          customConditions: native ? ['react-native'] : [],
        },
        files: ['prep-types.ts'],
      })
    )
    execFileSync(path.join(repoRoot, 'node_modules/.bin/tsc'), ['-p', 'prep-tsconfig.json'], {
      cwd: appRoot,
      stdio: 'inherit',
    })
  }
}
