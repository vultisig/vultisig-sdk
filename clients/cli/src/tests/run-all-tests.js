#!/usr/bin/env node

/**
 * CLI Test Runner
 * Runs all CLI tests and provides comprehensive reporting
 */

const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const CLI_PATH = path.resolve(__dirname, '../../bin/vultisig')
const TESTS_DIR = __dirname

// Colors for output
const colors = {
  red: '\033[0;31m',
  green: '\033[0;32m',
  yellow: '\033[1;33m',
  blue: '\033[0;34m',
  purple: '\033[0;35m',
  cyan: '\033[0;36m',
  white: '\033[1;37m',
  reset: '\033[0m',
}

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`
}

async function runTest(testFile, testName) {
  return new Promise(resolve => {
    console.log(`\n${colorize('🧪 Running:', 'blue')} ${testName}`)

    const startTime = Date.now()
    const testProcess = spawn('node', [testFile], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: path.resolve(__dirname, '../..'), // Run from CLI root directory
    })

    let stdout = ''
    let stderr = ''

    testProcess.stdout.on('data', data => {
      stdout += data.toString()
    })

    testProcess.stderr.on('data', data => {
      stderr += data.toString()
    })

    testProcess.on('close', code => {
      const duration = Date.now() - startTime

      if (code === 0) {
        console.log(`${colorize('✅ PASSED:', 'green')} ${testName} ${colorize(`(${duration}ms)`, 'cyan')}`)
        resolve({ name: testName, passed: true, duration, output: stdout })
      } else {
        console.log(`${colorize('❌ FAILED:', 'red')} ${testName} ${colorize(`(${duration}ms)`, 'cyan')}`)
        console.log(`${colorize('STDOUT:', 'yellow')}\n${stdout}`)
        console.log(`${colorize('STDERR:', 'red')}\n${stderr}`)
        resolve({
          name: testName,
          passed: false,
          duration,
          output: stderr || stdout,
        })
      }
    })

    // Timeout after 60 seconds
    setTimeout(() => {
      testProcess.kill('SIGKILL')
      console.log(`${colorize('⏰ TIMEOUT:', 'yellow')} ${testName}`)
      resolve({
        name: testName,
        passed: false,
        duration: 60000,
        output: 'Test timed out',
      })
    }, 60000)
  })
}

async function runCLICommand(command, args = []) {
  return new Promise(resolve => {
    const fullCommand = [CLI_PATH, ...command.split(' '), ...args]
    console.log(`${colorize('🔧 Running CLI:', 'purple')} ${fullCommand.join(' ')}`)

    const startTime = Date.now()
    const cliProcess = spawn(fullCommand[0], fullCommand.slice(1), {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: path.resolve(__dirname, '../..'), // Run from CLI root directory where vaults/ exists
    })

    let stdout = ''
    let stderr = ''

    cliProcess.stdout.on('data', data => {
      stdout += data.toString()
    })

    cliProcess.stderr.on('data', data => {
      stderr += data.toString()
    })

    cliProcess.on('close', code => {
      const duration = Date.now() - startTime
      resolve({ code, stdout, stderr, duration })
    })

    // Timeout after 30 seconds
    setTimeout(() => {
      cliProcess.kill('SIGKILL')
      resolve({
        code: -1,
        stdout,
        stderr: 'Command timed out',
        duration: 30000,
      })
    }, 30000)
  })
}

async function validateCLIBuild() {
  console.log(`${colorize('🔍 Validating CLI build...', 'blue')}`)

  if (!fs.existsSync(CLI_PATH)) {
    console.log(`${colorize('❌ CLI binary not found:', 'red')} ${CLI_PATH}`)
    console.log(`${colorize('💡 Run:', 'yellow')} yarn build`)
    return false
  }

  // Test basic CLI functionality
  const result = await runCLICommand('--version')
  if (result.code !== 0) {
    console.log(`${colorize('❌ CLI version check failed:', 'red')}`)
    console.log(`STDERR: ${result.stderr}`)
    return false
  }

  console.log(`${colorize('✅ CLI build validated:', 'green')} v${result.stdout.trim()}`)
  return true
}

async function runBasicCLITests() {
  console.log(`\n${colorize('🧪 Running Basic CLI Tests...', 'white')}`)

  const tests = [
    { command: '--help', description: 'Help command' },
    { command: '--version', description: 'Version command' },
    { command: 'list', description: 'List vaults' },
    { command: 'init', description: 'Initialize directories' },
  ]

  const results = []

  for (const test of tests) {
    const result = await runCLICommand(test.command)
    const passed = result.code === 0

    if (passed) {
      console.log(`${colorize('✅', 'green')} ${test.description} ${colorize(`(${result.duration}ms)`, 'cyan')}`)
    } else {
      console.log(`${colorize('❌', 'red')} ${test.description} ${colorize(`(${result.duration}ms)`, 'cyan')}`)
      console.log(`   Error: ${result.stderr || 'Unknown error'}`)
    }

    results.push({ ...test, passed, duration: result.duration })
  }

  return results
}

async function runAddressTests() {
  console.log(`\n${colorize('🔑 Running Address Derivation Tests...', 'white')}`)

  const networks = ['bitcoin', 'ethereum', 'solana', 'litecoin', 'dogecoin']
  const results = []

  for (const network of networks) {
    const result = await runCLICommand('address', [`--network`, network])
    const passed = result.code === 0 && result.stdout.includes(`${network}:`)

    if (passed) {
      // Extract the derived address
      const addressMatch = result.stdout.match(new RegExp(`${network}: ([A-Za-z0-9]+)`, 'i'))
      const address = addressMatch ? addressMatch[1] : 'Unknown'
      console.log(`${colorize('✅', 'green')} ${network}: ${address} ${colorize(`(${result.duration}ms)`, 'cyan')}`)
    } else {
      console.log(`${colorize('❌', 'red')} ${network} derivation failed ${colorize(`(${result.duration}ms)`, 'cyan')}`)
      console.log(`   Error: ${result.stderr || result.stdout}`)
    }

    results.push({ network, passed, duration: result.duration })
  }

  return results
}

async function main() {
  console.log(`${colorize('🚀 Vultisig CLI Test Suite', 'white')}`)
  console.log(`${colorize('='.repeat(50), 'blue')}\n`)

  const allResults = []

  // 1. Validate CLI build
  const buildValid = await validateCLIBuild()
  if (!buildValid) {
    process.exit(1)
  }

  // 2. Run basic CLI tests
  const basicResults = await runBasicCLITests()
  allResults.push(...basicResults)

  // 3. Run address derivation tests
  const addressResults = await runAddressTests()
  allResults.push(...addressResults)

  // 4. Summary
  console.log(`\n${colorize('📊 Test Results Summary', 'white')}`)
  console.log(`${colorize('='.repeat(50), 'blue')}`)

  const passed = allResults.filter(r => r.passed).length
  const total = allResults.length
  const totalTime = allResults.reduce((sum, r) => sum + r.duration, 0)

  console.log(`${colorize('Tests:', 'blue')} ${passed}/${total} passed`)
  console.log(`${colorize('Time:', 'blue')} ${totalTime}ms total`)

  if (passed === total) {
    console.log(`\n${colorize('🎉 All tests passed!', 'green')}`)
    console.log(`${colorize('✅ CLI is working correctly with proper SDK integration', 'green')}`)
    process.exit(0)
  } else {
    console.log(`\n${colorize('❌ Some tests failed', 'red')}`)
    console.log(`${colorize('💡 Check the errors above and fix the issues', 'yellow')}`)
    process.exit(1)
  }
}

// Handle uncaught errors
process.on('uncaughtException', error => {
  console.error(`${colorize('💥 Uncaught Exception:', 'red')} ${error.message}`)
  process.exit(1)
})

process.on('unhandledRejection', reason => {
  console.error(`${colorize('💥 Unhandled Rejection:', 'red')} ${reason}`)
  process.exit(1)
})

main().catch(error => {
  console.error(`${colorize('💥 Test runner failed:', 'red')} ${error.message}`)
  process.exit(1)
})
