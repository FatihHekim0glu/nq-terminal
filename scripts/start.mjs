// Entry point of ./start.sh. It must run on the old Node it guards against, so it is plain ES2020 with top-level
// await and Node built-ins only; the launcher itself (web/scripts/start/launcher.ts) is TypeScript that needs
// Node 24 to strip its types.
//
//   1. Read web/package.json engines for the Node this terminal needs.
//   2. Node is new enough: import the launcher and run it.
//   3. Too old, and NQT_NODE_SWITCH is not "off": look for an installed Node that is new enough in a fixed list
//      of local places (nodeGuard.mjs; only `--version` is run on them), say so in one line, and run this same
//      script again under it, passing signals and the exit code through.
//   4. Otherwise print a plain refusal instead of the ERR_UNKNOWN_BUILTIN_MODULE node:sqlite crash.
// Nothing is installed and nothing outside this folder is written.
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkNode, nodeCandidates, pickCandidate, refusalText, switchNotice } from '../web/scripts/start/nodeGuard.mjs'

const scriptPath = fileURLToPath(import.meta.url)
const terminalDir = path.resolve(path.dirname(scriptPath), '..')
const argv = process.argv.slice(2)
const FORWARDED = ['SIGINT', 'SIGTERM', 'SIGHUP']

function stop(message) {
  console.error(`start: ${message}`)
  return 1
}

function readEngines() {
  const file = path.join(terminalDir, 'web', 'package.json')
  try {
    return JSON.parse(readFileSync(file, 'utf8')).engines
  } catch (error) {
    throw new Error(`cannot read ${file}: ${error.message}`)
  }
}

function probe(candidate) {
  const run = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
  return run.status === 0 ? run.stdout.trim() : null
}

/** Runs this script again under `node`, forwarding Ctrl+C and friends, and resolves with its exit code. */
function rerunUnder(node) {
  return new Promise((resolve) => {
    const env = { ...process.env, PATH: `${path.dirname(node)}${path.delimiter}${process.env.PATH || ''}`, NQT_NODE_SWITCH: 'off' }
    const child = spawn(node, [scriptPath, ...argv], { stdio: 'inherit', env })
    for (const signal of FORWARDED) process.on(signal, () => child.kill(signal))
    child.once('error', (error) => resolve(stop(`could not run ${node}: ${error.message}`)))
    child.once('exit', (code, signal) => resolve(signal ? 128 + (os.constants.signals[signal] || 0) : code === null ? 1 : code))
  })
}

async function run() {
  let verdict
  try {
    verdict = checkNode(process.version, readEngines())
  } catch (error) {
    return stop(error.message)
  }
  if (verdict.ok) {
    const { main } = await import('../web/scripts/start/launcher.ts')
    return main(argv, { terminalDir })
  }
  if (process.env.NQT_NODE_SWITCH !== 'off') {
    const home = process.env.HOME || os.homedir()
    const candidates = nodeCandidates({ home, platform: process.platform, env: process.env, required: verdict.required })
    const picked = pickCandidate(candidates, probe, verdict.required)
    if (picked !== null) {
      console.log(switchNotice(verdict.found, picked))
      return rerunUnder(picked.path)
    }
  }
  console.error(refusalText(verdict))
  return 1
}

process.exitCode = await run()
