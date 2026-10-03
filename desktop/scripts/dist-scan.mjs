// The dist scan of desktop-check.yml (03 section 16), run locally (04 D5.3): the page build (web/dist) and any bundle
// folder hold no private key, no signing key and no PRIVATE marker. Nothing in this app is signed and there is no
// updater, so none of these may be present anywhere a release could pick them up.
//
//   node desktop/scripts/dist-scan.mjs [--dist <dir>]... [--bundle <dir>]...
//
//   exit 0  clean (a bundle folder that does not exist is said to be not built and skipped)
//   exit 1  at least one finding; the report names the file and the rule, never the key text
//   exit 2  nothing to scan (no or empty dist folder) or a bad argument: a scan that scanned nothing never passes
//
// With no --dist the scan reads terminal/web/dist. With no --bundle it reads $CARGO_TARGET_DIR/release/bundle when that
// variable is set. The NSIS payload inside a built installer is compressed, so for an installer the scan sees the
// file names and the stub, and the artefact check (artefact-check.mjs) reads the installed layout. Node built-ins only.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url))
const MAX_FILE_BYTES = 512 * 1024 * 1024
const WORD = '(?<![A-Za-z0-9_])'
const WORD_END = '(?![A-Za-z0-9_])'

// Text rules. The bare marker is a whole word, so a bundled library's PRIVATE_PLUGIN_SYMBOL is not a hit.
const TEXT_RULES = [
  ['private-key-block', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/],
  ['private-marker', new RegExp(`${WORD}PRIVATE${WORD_END}`)],
  ['signing-key', new RegExp([
    'TAURI_(?:SIGNING_)?PRIVATE_KEY(?:_PASSWORD)?', '[A-Z][A-Z0-9_]*_PRIVATE_KEY', '[A-Z0-9_]*SIGNING_KEY[A-Z0-9_]*',
    '(?:minisign|rsign) (?:encrypted )?secret key',
    'dW50cnVzdGVkIGNvbW1lbnQ6', // base64 of "untrusted comment:", the first line of a minisign or rsign key file
  ].join('|'))],
]

const KEY_FILE_EXTENSIONS = new Set(['.pem', '.key', '.pfx', '.p12', '.pkcs12', '.p8', '.jks', '.keystore', '.snk', '.gpg', '.asc'])
const KEY_FILE_NAMES = /^(?:id_(?:rsa|dsa|ecdsa|ed25519)|\.env(?:\..+)?)$/
const WIDE_EXTENSIONS = new Set(['.exe', '.dll', '.msi', '.sys', '.node'])

// The rules that match one piece of text, as names.
export function scanText(text) {
  return TEXT_RULES.filter(([, pattern]) => pattern.test(text)).map(([rule]) => rule)
}

function keyFileName(name) {
  return KEY_FILE_EXTENSIONS.has(path.extname(name).toLowerCase()) || KEY_FILE_NAMES.test(name)
}

function rulesOfFile(file, size) {
  if (size > MAX_FILE_BYTES) return ['too-large-to-scan']
  const bytes = fs.readFileSync(file)
  const found = new Set(scanText(bytes.toString('latin1')))
  if (WIDE_EXTENSIONS.has(path.extname(file).toLowerCase())) {
    for (const start of [0, 1]) scanText(bytes.subarray(start).toString('utf16le')).forEach((rule) => found.add(rule))
  }
  return [...found]
}

function listFiles(root) {
  const files = []
  const pending = [root]
  while (pending.length > 0) {
    const folder = pending.pop()
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name)
      if (entry.isDirectory()) pending.push(full)
      else if (entry.isFile()) files.push(full)
    }
  }
  return files.sort()
}

// Findings of one folder: { file (relative), rule }.
export function scanDirectory(root) {
  const findings = []
  for (const file of listFiles(root)) {
    const relative = path.relative(root, file)
    if (keyFileName(path.basename(file))) findings.push({ file: relative, rule: 'key-file' })
    for (const rule of rulesOfFile(file, fs.statSync(file).size)) findings.push({ file: relative, rule })
  }
  return findings
}

function isFolder(target) {
  return fs.existsSync(target) && fs.statSync(target).isDirectory()
}

export function runScan({ dists, bundles }) {
  const lines = []
  let exitCode = 0
  let scannedFiles = 0
  for (const dist of dists) {
    if (!isFolder(dist) || listFiles(dist).length === 0) {
      return { exitCode: 2, lines: [`dist-scan: nothing to scan in ${dist} (build the page first)`] }
    }
  }
  const targets = [...dists.map((d) => ['dist', d]), ...bundles.map((b) => ['bundle', b])]
  for (const [kind, target] of targets) {
    if (!isFolder(target)) {
      lines.push(`dist-scan: ${kind} ${target} not built, skipped`)
      continue
    }
    const findings = scanDirectory(target)
    scannedFiles += listFiles(target).length
    for (const f of findings) lines.push(`  FOUND  ${f.rule}  ${path.join(target, f.file)}`)
    if (findings.length > 0) exitCode = 1
  }
  lines.unshift(`dist-scan: ${scannedFiles} files scanned, ${exitCode === 0 ? 'no private key, signing key or PRIVATE marker' : 'FINDINGS'}`)
  return { exitCode, lines }
}

function parseArguments(argv, environment) {
  const dists = []
  const bundles = []
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if ((flag === '--dist' || flag === '--bundle') && i + 1 < argv.length) {
      i += 1
      ;(flag === '--dist' ? dists : bundles).push(path.resolve(argv[i]))
    } else throw new Error(`unknown or incomplete argument ${flag}`)
  }
  if (dists.length === 0) dists.push(DEFAULT_DIST)
  if (bundles.length === 0 && environment.CARGO_TARGET_DIR) bundles.push(path.join(environment.CARGO_TARGET_DIR, 'release', 'bundle'))
  return { dists, bundles }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { exitCode, lines } = runScan(parseArguments(process.argv.slice(2), process.env))
    console.log(lines.join('\n'))
    process.exitCode = exitCode
  } catch (error) {
    console.error(`dist-scan: ${error.message}`)
    process.exitCode = 2
  }
}
