// Born-failing tests for desktop/scripts/dist-scan.mjs (03 section 16, the dist scan of desktop-check.yml; 04 D5.3).
// Run: node --test desktop/scripts/tests
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runScan, scanDirectory, scanText } from '../dist-scan.mjs'

const SCRIPT = fileURLToPath(new URL('../dist-scan.mjs', import.meta.url))
const BODY = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7'
const roots = []

function tempTree(files) {
  const root = fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), 'dist-scan-test-'))
  roots.push(root)
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  return root
}

after(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }) })

const CLEAN = {
  'index.html': '<!doctype html><title>NQ</title><script type="module" src="/assets/app.js"></script>',
  'assets/app.js': 'export const PRIVATE_PLUGIN_SYMBOL = Symbol("p"); const privateCache = 1; // a private field, lower case',
  'assets/app.css': 'body{color:#111}',
}

test('a clean dist, including the bundled library name PRIVATE_PLUGIN_SYMBOL, has no finding', () => {
  assert.deepEqual(scanDirectory(tempTree(CLEAN)), [])
})

test('a planted -----BEGIN PRIVATE KEY----- file is found (born failing)', () => {
  const root = tempTree({ ...CLEAN, 'assets/leak.txt': `-----BEGIN PRIVATE KEY-----\n${BODY}\n-----END PRIVATE KEY-----\n` })
  const found = scanDirectory(root)
  assert.ok(found.some((f) => f.rule === 'private-key-block' && f.file === path.join('assets', 'leak.txt')), JSON.stringify(found))
})

test('every PEM flavour of private key is found', () => {
  for (const kind of ['RSA ', 'EC ', 'DSA ', 'OPENSSH ', 'ENCRYPTED ', '']) {
    assert.ok(scanText(`-----BEGIN ${kind}PRIVATE KEY-----`).some((r) => r === 'private-key-block'), kind)
  }
  assert.ok(scanText('-----BEGIN PGP PRIVATE KEY BLOCK-----').includes('private-key-block'))
  assert.deepEqual(scanText('-----BEGIN CERTIFICATE-----\nMIIC\n-----END CERTIFICATE-----'), [])
  assert.deepEqual(scanText('-----BEGIN PUBLIC KEY-----'), [])
})

test('the bare PRIVATE marker is found, as a whole word only', () => {
  assert.ok(scanText('const k = "PRIVATE"').includes('private-marker'))
  assert.ok(scanText('key: PRIVATE\n').includes('private-marker'))
  assert.deepEqual(scanText('PRIVATE_PLUGIN_SYMBOL, xPRIVATE, PRIVATEx, a private field'), [])
})

test('Tauri signing key names and minisign key text are found', () => {
  assert.ok(scanText('TAURI_SIGNING_PRIVATE_KEY=dW50').includes('signing-key'))
  assert.ok(scanText('process.env.TAURI_PRIVATE_KEY').includes('signing-key'))
  assert.ok(scanText('SIGNING_KEY_PASSWORD').includes('signing-key'))
  assert.ok(scanText('untrusted comment: minisign encrypted secret key\nRWRTY0Iy').includes('signing-key'))
  assert.ok(scanText('untrusted comment: rsign encrypted secret key').includes('signing-key'))
  assert.ok(scanText(Buffer.from('untrusted comment: rsign encrypted secret key').toString('base64')).includes('signing-key'))
})

test('a key file is found by its name even when its content looks harmless', () => {
  for (const name of ['server.pem', 'tauri.key', 'cert.pfx', 'sign.p12', 'AuthKey.p8', 'store.jks', 'id_rsa', 'id_ed25519', '.env', '.env.local', 'app.keystore']) {
    const found = scanDirectory(tempTree({ ...CLEAN, [`assets/${name}`]: 'x' }))
    assert.ok(found.some((f) => f.rule === 'key-file'), name)
  }
  assert.deepEqual(scanDirectory(tempTree({ ...CLEAN, 'assets/keyboard.js': 'x', 'assets/monkey.css': 'x', 'assets/id_rsa.pub': 'ssh-rsa AAAA' })), [])
})

test('a marker deep in a source map or in a binary is found', () => {
  const map = scanDirectory(tempTree({ ...CLEAN, 'assets/a/b/app.js.map': '{"sourcesContent":["-----BEGIN PRIVATE KEY-----"]}' }))
  assert.equal(map.length > 0, true)
  const binary = Buffer.concat([Buffer.alloc(5000, 0), Buffer.from('TAURI_SIGNING_PRIVATE_KEY'), Buffer.alloc(5000, 0xff)])
  assert.ok(scanDirectory(tempTree({ 'index.html': 'x', 'setup.exe': binary })).some((f) => f.rule === 'signing-key'))
  const wide = Buffer.concat([Buffer.alloc(3), Buffer.from('-----BEGIN PRIVATE KEY-----', 'utf16le')])
  assert.ok(scanDirectory(tempTree({ 'index.html': 'x', 'setup.exe': wide })).some((f) => f.rule === 'private-key-block'))
})

test('the report names the file and the rule but never prints the key text', () => {
  const root = tempTree({ ...CLEAN, 'assets/leak.txt': `-----BEGIN PRIVATE KEY-----\n${BODY}\n` })
  const out = runScan({ dists: [root], bundles: [] })
  assert.equal(out.exitCode, 1)
  const text = out.lines.join('\n')
  assert.match(text, /leak\.txt/)
  assert.equal(text.includes(BODY), false)
})

test('a missing or empty dist is an error, not a pass', () => {
  assert.equal(runScan({ dists: [path.join(os.tmpdir(), 'no-such-dist-folder')], bundles: [] }).exitCode, 2)
  assert.equal(runScan({ dists: [tempTree({})], bundles: [] }).exitCode, 2)
})

test('a missing bundle folder is skipped and said so, while a present one is scanned', () => {
  const dist = tempTree(CLEAN)
  const skipped = runScan({ dists: [dist], bundles: [path.join(os.tmpdir(), 'no-such-bundle-folder')] })
  assert.equal(skipped.exitCode, 0)
  assert.match(skipped.lines.join('\n'), /not built/)
  const bundle = tempTree({ 'nsis/app_x64-setup.exe': 'MZ', 'nsis/signing.key': 'x' })
  assert.equal(runScan({ dists: [dist], bundles: [bundle] }).exitCode, 1)
})

test('the command line exits 1 on a planted key, 0 on a clean dist and 2 on a missing one', () => {
  const planted = tempTree({ ...CLEAN, 'leak.txt': '-----BEGIN PRIVATE KEY-----' })
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', windowsHide: true })
  assert.equal(run('--dist', planted).status, 1)
  assert.equal(run('--dist', tempTree(CLEAN)).status, 0)
  assert.equal(run('--dist', path.join(os.tmpdir(), 'no-such-dist-folder')).status, 2)
  assert.equal(run('--nonsense').status, 2)
})

test('the real web/dist, when it has been built, is clean', () => {
  const dist = fileURLToPath(new URL('../../../web/dist', import.meta.url))
  if (!fs.existsSync(dist)) return
  assert.deepEqual(scanDirectory(dist), [])
})
