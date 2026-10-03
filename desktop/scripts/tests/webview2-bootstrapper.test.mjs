// Born-failing tests for desktop/scripts/webview2-bootstrapper.ps1 (the build's check of the WebView2 bootstrapper the
// installer embeds and runs silently). The bundler downloads that file without a hash or a signature check and reuses
// whatever sits in its cache folder, so the build reads its path from the generated installer script and requires a
// valid Microsoft Corporation signature. The planted files are unsigned or badly signed; no test touches the network.
//
//   node --test desktop/scripts/tests/webview2-bootstrapper.test.mjs
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test, { after } from 'node:test'

const SCRIPT = fileURLToPath(new URL('../webview2-bootstrapper.ps1', import.meta.url))
const SCRATCH = process.env.NQT_TEST_TMP || 'D:/dev/tmp/w5a-bootstrapper-tests'
const CACHED = path.join(process.env.LOCALAPPDATA ?? '', 'tauri', 'MicrosoftEdgeWebview2Setup.exe')
const OTHER_PUBLISHER = 'C:\\Program Files\\nodejs\\node.exe'
const created = []

function scratch(name) {
  const dir = path.join(SCRATCH, `${name}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`)
  fs.mkdirSync(dir, { recursive: true })
  created.push(dir)
  return dir
}
after(() => { for (const dir of created) fs.rmSync(dir, { recursive: true, force: true }) })

function run(args) {
  const out = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args], { encoding: 'utf8', windowsHide: true })
  let json = null
  try { json = JSON.parse(out.stdout) } catch { /* the message is the assertion */ }
  return { status: out.status, json, text: out.stdout + out.stderr }
}

test('an unsigned file is reported unsigned, with its sha256, and fails', () => {
  const file = path.join(scratch('unsigned'), 'MicrosoftEdgeWebview2Setup.exe')
  fs.writeFileSync(file, 'MZ a planted stand-in')
  const result = run(['-Path', file])
  assert.equal(result.status, 1, result.text)
  assert.notEqual(result.json.signature_status, 'Valid')
  assert.equal(result.json.sha256, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'))
  assert.equal(result.json.valid, false)
})

test('a missing file fails', () => {
  const result = run(['-Path', path.join(scratch('missing'), 'nothing.exe')])
  assert.equal(result.status, 1, result.text)
})

test('a file signed by another publisher fails (when this PC has one)', { skip: !fs.existsSync(OTHER_PUBLISHER) }, () => {
  const result = run(['-Path', OTHER_PUBLISHER])
  assert.equal(result.status, 1, result.text)
  assert.equal(result.json.valid, false)
})

test('the path is read from the installer script define', () => {
  const dir = scratch('nsi')
  const file = path.join(dir, 'MicrosoftEdgeWebview2Setup.exe')
  fs.writeFileSync(file, 'MZ a planted stand-in')
  const nsi = path.join(dir, 'installer.nsi')
  fs.writeFileSync(nsi, `!define INSTALLWEBVIEW2MODE "embedBootstrapper"\r\n!define WEBVIEW2BOOTSTRAPPERPATH "${file}"\r\n`)
  const result = run(['-Nsi', nsi])
  assert.equal(result.json.path.toLowerCase(), file.toLowerCase(), result.text)
})

test('an installer script with no bootstrapper define fails', () => {
  const nsi = path.join(scratch('nodefine'), 'installer.nsi')
  fs.writeFileSync(nsi, '!define INSTALLWEBVIEW2MODE "downloadBootstrapper"\n')
  const result = run(['-Nsi', nsi])
  assert.equal(result.status, 1, result.text)
})

test('the bundler cache file on this PC is validly signed by Microsoft Corporation', { skip: !fs.existsSync(CACHED) }, () => {
  const result = run(['-Path', CACHED])
  assert.equal(result.status, 0, result.text)
  assert.equal(result.json.signature_status, 'Valid')
  assert.match(result.json.signer, /O=Microsoft Corporation/)
  assert.match(result.json.sha256, /^[0-9a-f]{64}$/)
})
