// Broadcast a raw EIP-1559 transaction from an ECDSA signature and known tx fields
// Usage: node broadcast-raw.js

import { JsonRpcProvider } from 'ethers'
import { serializeTransaction as viemSerialize } from 'viem'

const provider = new JsonRpcProvider('https://ethereum-rpc.publicnode.com')

// Provided signature (r || s || v)
const sig = '0x645a16a24c4255a141c577a135989677d90ae558624d4494eccb78836fce32732276e73285c0cde5eac587688c10afee56d1f8f4e3bac9bde55308a9fb85aa00ed'

// Known tx fields used during signing (must match exactly)
const to = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' // USDC
const data = '0xa9059cbb00000000000000000000000065261c9d3b49367e6a49902B1e735b2e734F8ee700000000000000000000000000000000000000000000000000000000000f4240'
const chainId = 1
const nonce = 103
const gasLimit = 100000n
const gasPrice = 20_000_000_000n // 20 gwei
const maxPriorityFeePerGas = 2_000_000_000n // 2 gwei
const maxFeePerGas = gasPrice

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function getSerializedTxFromSignature() {
  if (sig.length !== 132) throw new Error(`Unexpected sig length: ${sig.length}`)

  let r = '0x' + sig.slice(2, 66)
  let s = '0x' + sig.slice(66, 130)
  const vByte = parseInt(sig.slice(130, 132), 16)
  let yParity = vByte & 1

  const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n
  const halfN = N >> 1n
  const sBI = BigInt(s)
  if (sBI > halfN) {
    const sFixed = (N - sBI).toString(16).padStart(64, '0')
    s = '0x' + sFixed
    yParity ^= 1
  }

  const tx = {
    type: 2,
    chainId,
    nonce,
    to,
    value: 0n,
    data,
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    accessList: [],
  }

  // Use viem to serialize EIP-1559 with signature
  return viemSerialize({
    type: 'eip1559',
    chainId,
    nonce,
    to,
    value: 0n,
    data,
    gas: gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
    accessList: [],
    signature: { r, s, yParity }
  })
}

async function main() {
  const raw = await getSerializedTxFromSignature()
  console.log('Raw tx:', raw.slice(0, 30) + '…', 'len=', raw.length)

  for (;;) {
    try {
      const resp = await provider.broadcastTransaction(raw)
      console.log('Broadcasted! Hash:', resp.hash)
      const receipt = await resp.wait()
      console.log('Confirmed in block', receipt.blockNumber)
      break
    } catch (e) {
      console.error('Broadcast failed:', e.message || e)
      await sleep(5000)
    }
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})


