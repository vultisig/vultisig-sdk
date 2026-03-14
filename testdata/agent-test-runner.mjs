#!/usr/bin/env node
/**
 * Vultisig Agent Integration Test Runner
 *
 * Pre-built NDJSON harness for the vultisig CLI --via-agent pipe mode.
 * Handles protocol details so test agents (opencode, etc.) don't have to.
 *
 * Usage:
 *   node agent-test-runner.mjs --message "Wrap 0.0001 ETH to WETH" \
 *     [--vault ci_test] [--password secret] [--backend-url http://localhost:9998] \
 *     [--sdk-dir /path/to/vultisig-sdk] [--timeout 300] [--max-turns 10]
 *
 * Outputs structured JSON to stdout with the full conversation and results.
 * All debug/protocol logs go to stderr.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    message:      { type: 'string' },
    followup:     { type: 'string', multiple: true, default: [] },
    vault:        { type: 'string', default: 'ci_test' },
    password:     { type: 'string', default: process.env.VAULT_PASSWORD || '' },
    'backend-url': { type: 'string', default: 'http://localhost:9998' },
    'sdk-dir':    { type: 'string', default: process.env.SDK_DIR || '.' },
    timeout:      { type: 'string', default: '300' },
    'max-turns':  { type: 'string', default: '10' },
    'turn-timeout': { type: 'string', default: '180' },
  },
  strict: true,
});

if (!args.message) {
  console.error('Usage: agent-test-runner.mjs --message "..." [options]');
  process.exit(2);
}

const TOTAL_TIMEOUT = parseInt(args.timeout) * 1000;
const TURN_TIMEOUT = parseInt(args['turn-timeout']) * 1000;
const MAX_TURNS = parseInt(args['max-turns']);

function log(msg) {
  process.stderr.write(`[${new Date().toISOString()}] ${msg}\n`);
}

// ── Spawn CLI ──
const child = spawn(
  'npx',
  ['tsx', 'clients/cli/src/index.ts', 'agent',
   '--vault', args.vault,
   '--password', args.password,
   '--backend-url', args['backend-url'],
   '--via-agent'],
  {
    cwd: args['sdk-dir'],
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  }
);

log(`Spawned CLI pid=${child.pid}`);

// ── State ──
let turnEvents = [];
let turnResolve = null;
let turnTimer = null;
let finished = false;
const conversation = [];
const toolCalls = [];

// ── NDJSON reader ──
const stdoutRl = createInterface({ input: child.stdout });
const stderrRl = createInterface({ input: child.stderr });

stderrRl.on('line', line => log(`[stderr] ${line}`));

stdoutRl.on('line', raw => {
  log(`[stdout] ${raw}`);
  let evt;
  try { evt = JSON.parse(raw); } catch { return; }
  turnEvents.push(evt);

  if (evt.type === 'tool_call' || evt.type === 'tool_result') {
    toolCalls.push(evt);
  }

  // Auto-respond to password
  if (evt.type === 'error' && evt.message === 'PASSWORD_REQUIRED') {
    log('Auto-sending password');
    send({ type: 'password', password: args.password });
    return;
  }

  // Auto-respond to confirmation
  if (evt.type === 'error' && typeof evt.message === 'string' && evt.message.startsWith('CONFIRMATION_REQUIRED')) {
    log('Auto-confirming');
    send({ type: 'confirm', confirmed: true });
    return;
  }

  // Done = end of turn
  if (evt.type === 'done') {
    if (turnTimer) { clearTimeout(turnTimer); turnTimer = null; }
    if (turnResolve) {
      const r = turnResolve;
      turnResolve = null;
      r(turnEvents);
    }
  }
});

function send(cmd) {
  const line = JSON.stringify(cmd);
  log(`[send] ${line}`);
  child.stdin.write(line + '\n');
}

function sendAndWait(content) {
  return new Promise(resolve => {
    turnEvents = [];
    turnResolve = resolve;
    turnTimer = setTimeout(() => {
      log('Turn timed out');
      if (turnResolve) { const r = turnResolve; turnResolve = null; r(turnEvents); }
    }, TURN_TIMEOUT);
    send({ type: 'message', content });
  });
}

function waitForReady() {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Ready timeout (60s)')), 60_000);
    const i = setInterval(() => {
      const r = turnEvents.find(e => e.type === 'ready');
      if (r) { clearInterval(i); clearTimeout(t); resolve(r); }
    }, 200);
  });
}

function extractTurnInfo(events) {
  const textDeltas = events.filter(e => e.type === 'text_delta').map(e => e.delta);
  const text = textDeltas.join('');
  const assistants = events.filter(e => e.type === 'assistant').map(e => e.content);
  const tools = events.filter(e => e.type === 'tool_call').map(e => e.action);
  const results = events.filter(e => e.type === 'tool_result');
  const errors = events.filter(e => e.type === 'error').map(e => e.message);
  const txHashes = [];

  // Extract tx hashes from tool results
  for (const r of results) {
    const d = JSON.stringify(r.data || {});
    const match = d.match(/0x[a-fA-F0-9]{64}/);
    if (match) txHashes.push(match[0]);
  }
  // Also check assistant text
  for (const a of [...assistants, text]) {
    const matches = a.matchAll(/0x[a-fA-F0-9]{64}/g);
    for (const m of matches) {
      if (!txHashes.includes(m[0])) txHashes.push(m[0]);
    }
  }

  return { text, assistants, tools, results, errors, txHashes };
}

// ── Cleanup ──
const globalTimer = setTimeout(() => {
  log('GLOBAL TIMEOUT');
  cleanup(1);
}, TOTAL_TIMEOUT);

function cleanup(code) {
  if (finished) return;
  finished = true;
  clearTimeout(globalTimer);
  try { child.stdin.end(); } catch {}
  setTimeout(() => {
    try { child.kill('SIGTERM'); } catch {}
    setTimeout(() => {
      // Output final structured result to stdout
      const output = {
        success: code === 0,
        turns: conversation,
        tool_calls: toolCalls.filter(t => t.type === 'tool_call').map(t => t.action),
        tool_results: toolCalls.filter(t => t.type === 'tool_result').map(t => ({
          action: t.action,
          success: t.success,
          data: t.data,
        })),
        tx_hashes: conversation.flatMap(t => t.tx_hashes || []),
      };
      console.log(JSON.stringify(output, null, 2));
      process.exit(code);
    }, 500);
  }, 1000);
}

child.on('exit', (code, sig) => {
  log(`CLI exited code=${code} signal=${sig}`);
  if (!finished) cleanup(code ?? 1);
});

// ── Main ──
async function main() {
  log('=== Agent Test Runner ===');
  turnEvents = [];
  const ready = await waitForReady();
  log(`Ready: vault=${ready.vault}`);

  // Build message queue: initial message + any followups
  const messages = [args.message, ...args.followup];
  let allTxHashes = [];

  for (let i = 0; i < MAX_TURNS && messages.length > 0; i++) {
    const msg = messages.shift();
    log(`--- Turn ${i + 1}: ${msg.substring(0, 100)} ---`);

    const events = await sendAndWait(msg);
    const info = extractTurnInfo(events);
    conversation.push({ turn: i + 1, message: msg, ...info });

    log(`Turn ${i + 1}: tools=[${info.tools.join(',')}] txHashes=[${info.txHashes.join(',')}] errors=[${info.errors.join(',')}]`);
    if (info.text) log(`Turn ${i + 1} text: ${info.text.substring(0, 300)}`);

    allTxHashes.push(...info.txHashes);

    // If we got a tx hash, we're done
    if (info.txHashes.length > 0) {
      log(`Transaction found: ${info.txHashes[0]}`);
      break;
    }

    // If the agent is asking a question and we have no more followups, auto-respond
    if (messages.length === 0 && i < MAX_TURNS - 1) {
      const lastText = (info.assistants[info.assistants.length - 1] || info.text || '').toLowerCase();
      if (lastText.includes('?') || lastText.includes('would you') || lastText.includes('shall i') || lastText.includes('confirm')) {
        messages.push('Yes, proceed. Execute the transaction.');
      } else if (info.errors.length > 0 && !info.errors.every(e => e.startsWith('PASSWORD') || e.startsWith('CONFIRMATION'))) {
        log('Errors detected, stopping');
        break;
      } else if (info.tools.length === 0 && !info.text) {
        log('Empty turn, stopping');
        break;
      } else {
        // Agent finished without asking — might need a nudge
        messages.push('Continue. If the transaction is ready, sign and broadcast it.');
      }
    }

    // Brief pause between turns
    await new Promise(r => setTimeout(r, 1000));
  }

  log(`Finished. tx_hashes=[${allTxHashes.join(',')}]`);
  cleanup(allTxHashes.length > 0 ? 0 : 1);
}

main().catch(err => {
  log(`FATAL: ${err.message}`);
  cleanup(1);
});
