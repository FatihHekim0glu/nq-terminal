// ./start.sh doctor: a checklist of what the terminal needs on this machine, one line per check ('ok    ...' or
// 'FAIL  ...' with the fix), ending with the mode that would start and the command to run. Pure: facts.ts
// gathers the facts; this only words them. A FAIL is advice, not a gate: the demo needs only Node and the web
// dependencies, so a machine without the nq-lab venv still starts in DEMO ONLY mode.
import { join } from 'node:path'
import { BACKEND_PORT, DEMO_PORT, DEV_PORT, type Facts, type ResolvedMode } from './plan.ts'

const OK = 'ok    '
const FAIL = 'FAIL  '

const PORT_LABELS: ReadonlyArray<readonly [number, string]> = [
  [BACKEND_PORT, 'terminal backend'],
  [DEV_PORT, 'Vite dev server'],
  [DEMO_PORT, 'demo'],
]

function nodeMajor(version: string): number {
  const match = /^v?(\d+)/.exec(version.trim())
  return match === null ? -1 : Number(match[1])
}

function portLine(facts: Facts, port: number, label: string): string {
  const state = facts.ports[String(port)] ?? 'free'
  if (state === 'free') return `${OK}port ${port} is free (${label})`
  if (state === 'terminal') {
    return port === BACKEND_PORT
      ? `${OK}port ${port} answers as the terminal (./start.sh opens it and starts nothing)`
      : `${OK}port ${port} answers as the terminal`
  }
  const fix = port === DEV_PORT ? 'stop that program (only --dev needs this port)' : 'stop that program, or choose another port with --port'
  return `${FAIL}port ${port} is taken by another program (${label}). Fix: ${fix}`
}

function nodeLine(facts: Facts): string {
  const version = facts.node.version.replace(/^v/, '')
  const need = `needs ${facts.requiredNode} or later`
  if (nodeMajor(version) >= facts.requiredNode) return `${OK}node ${version} at ${facts.node.path} (${need})`
  return (
    `${FAIL}node ${version} at ${facts.node.path} is too old (${need}). ` +
    `Fix: nvm install ${facts.requiredNode}, or set NQT_NODE to a Node ${facts.requiredNode} binary`
  )
}

function browserLine(facts: Facts): string {
  if (facts.browser.bundled) return `${OK}browser for Playwright: bundled Chromium`
  if (facts.browser.chrome) return `${OK}browser for Playwright: Google Chrome`
  return `${FAIL}no browser for Playwright. Fix: run corepack pnpm exec playwright install chromium in web, or install Google Chrome`
}

function pythonLines(facts: Facts): string[] {
  const { python, labRoot } = facts
  const sync = `run uv sync in ${labRoot}`
  return [
    python.exists ? `${OK}venv python at ${python.path}` : `${FAIL}no venv python at ${python.path}. Fix: ${sync}`,
    python.fastapi
      ? `${OK}fastapi and uvicorn import in the venv`
      : `${FAIL}fastapi and uvicorn cannot be imported ${python.exists ? 'by the venv python' : '(no venv python)'}. Fix: ${sync}`,
    python.nqLab
      ? `${OK}nq_lab imports in the venv`
      : `${FAIL}nq_lab not found. Fix: put this folder inside the nq-lab checkout, or set NQT_LAB_ROOT to the nq-lab folder that holds .venv`,
  ]
}

function contractLine(facts: Facts): string {
  if (facts.contract === 'in sync') return `${OK}API types are in sync with the contract`
  if (facts.contract === 'stale') return `${FAIL}API types are out of date with the contract. Fix: run corepack pnpm gen:api in web`
  return `${FAIL}could not check the API types against the contract. Fix: install the web dependencies, then run corepack pnpm check:api in web`
}

function extraPorts(facts: Facts): number[] {
  const fixed = new Set(PORT_LABELS.map(([port]) => String(port)))
  return Object.keys(facts.ports)
    .filter((key) => !fixed.has(key))
    .map(Number)
    .sort((a, b) => a - b)
}

export function doctorLines(facts: Facts, resolved: ResolvedMode): string[] {
  const lines: string[] = [
    nodeLine(facts),
    facts.webDeps
      ? `${OK}web dependencies installed (${join(facts.terminalDir, 'web', 'node_modules')})`
      : `${FAIL}web dependencies are missing (no node_modules/vite in ${join(facts.terminalDir, 'web')}). ` +
        'Fix: ./start.sh installs them, or run corepack pnpm install --frozen-lockfile in web',
    facts.corepack ? `${OK}corepack on PATH` : `${FAIL}corepack not found on PATH. Fix: install Node 24 (it ships corepack), then run corepack enable`,
    browserLine(facts),
    ...pythonLines(facts),
  ]
  if (facts.fixtureDir !== null) lines.push(`${OK}fixture folder ${facts.fixtureDir} (NQT_FIXTURE_DIR): the backend serves its files`)
  for (const [port, label] of PORT_LABELS) lines.push(portLine(facts, port, label))
  for (const port of extraPorts(facts)) lines.push(portLine(facts, port, 'asked for with --port'))
  lines.push(contractLine(facts))
  lines.push(
    facts.buildNeeded
      ? `${OK}web/dist is older than the sources (a full start rebuilds it)`
      : `${OK}web/dist is up to date`,
  )
  lines.push(`mode: ${resolved.mode} (${resolved.reason}). Next: ./start.sh`)
  return lines
}
