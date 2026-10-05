// Born-failing tests of the artefact check (04 D5.4, 05 G07). Every guard is shown to fail on its planted bad case
// (a .parquet file, a path under results/, an exe whose manifest lost an entry, a copy importing libwinpthread-1.dll,
// an installer that asks for administrator, an exe with an updater in its embedded config) and to pass on a clean
// one. The exes are small PE files built here, so the tests need no build output; the real spike exe whose linker
// dropped a manifest entry (W0A) is used as well when it is on this PC.
//
//   node --test desktop/scripts/tests/artefact-check.test.mjs
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test, { after } from 'node:test'
import {
  PINNED_LOADER_SHA256, configProblems, exeProblems, hooksProblems, installerProblems, pathProblems, checkRelease, listFiles,
} from '../artefact-check.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHECK = path.join(HERE, '..', 'artefact-check.mjs')
const MANIFEST = fs.readFileSync(path.join(HERE, '..', '..', 'src-tauri', 'windows', 'app.manifest'), 'utf8')
const SCRATCH = process.env.NQT_TEST_TMP || 'D:/dev/tmp/w5a-package-tests'
const HOOKS_FILE = path.join(HERE, '..', '..', 'src-tauri', 'windows', 'nsis', 'hooks.nsh')
const HOOKS_CONFIG_PATH = 'windows/nsis/hooks.nsh'
const HOOKS_INCLUDE = String.raw`D:\repo\desktop\src-tauri\windows\nsis\hooks.nsh`
const SPIKE_EXE = 'D:/dev/spikes/tauri-shell/src-tauri/target/release/nq-shell.exe'
const GOOD_IMPORTS = ['KERNEL32.dll', 'api-ms-win-core-synch-l1-2-0.dll', 'user32.dll']
const IDENTIFIER = 'dev.nqlab.terminal'
const BOOTSTRAPPER_PATH = String.raw`C:\Users\x\AppData\Local\tauri\MicrosoftEdgeWebview2Setup.exe`
const goodBootstrapper = (extra = {}) => ({
  path: BOOTSTRAPPER_PATH, sha256: 'a'.repeat(64), signature_status: 'Valid', signer: 'CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US', ...extra,
})

// ---- a minimal PE: .idata (import table) and .rsrc (one RT_MANIFEST resource per manifest) ------------------------

const align = (n, to) => Math.ceil(n / to) * to

function idataSection(names, rva) {
  const table = Buffer.alloc((names.length + 1) * 20)
  const strings = []
  let at = table.length
  names.forEach((name, i) => {
    table.writeUInt32LE(rva + at, i * 20 + 12)
    const s = Buffer.from(name + '\0', 'latin1')
    strings.push(s)
    at += s.length
  })
  return Buffer.concat([table, ...strings])
}

// A flat three-level resource tree: type 24 -> id i+1 -> language 0x0409 -> data entry.
function rsrcFlat(manifests, rva) {
  const n = manifests.length
  const dirSize = (count) => 16 + count * 8
  const typeAt = dirSize(1)
  const namesAt = typeAt + dirSize(n)
  const entriesAt = namesAt + n * dirSize(1)
  const bodiesAt = entriesAt + n * 16
  const bodies = manifests.map((m) => Buffer.from(m, 'utf8'))
  const total = bodiesAt + bodies.reduce((a, b) => a + align(b.length, 4), 0)
  const out = Buffer.alloc(total)
  const dir = (at, count) => out.writeUInt16LE(count, at + 14)
  const entry = (at, i, id, target, isDir) => {
    out.writeUInt32LE(id, at + 16 + i * 8)
    out.writeUInt32LE(isDir ? (0x80000000 | target) >>> 0 : target, at + 16 + i * 8 + 4)
  }
  dir(0, 1)
  entry(0, 0, 24, typeAt, true)
  dir(typeAt, n)
  manifests.forEach((_, i) => entry(typeAt, i, i + 1, namesAt + i * dirSize(1), true))
  let bodyAt = bodiesAt
  manifests.forEach((_, i) => {
    const at = namesAt + i * dirSize(1)
    dir(at, 1)
    entry(at, 0, 0x0409, entriesAt + i * 16, false)
    out.writeUInt32LE(rva + bodyAt, entriesAt + i * 16)
    out.writeUInt32LE(bodies[i].length, entriesAt + i * 16 + 4)
    bodies[i].copy(out, bodyAt)
    bodyAt += align(bodies[i].length, 4)
  })
  return out
}

export function buildPe({ imports = GOOD_IMPORTS, manifests = [MANIFEST], subsystem = 2 } = {}) {
  const FILE_ALIGN = 0x200
  const idataRva = 0x1000
  const idata = idataSection(imports, idataRva)
  const rsrcRva = 0x1000 + align(Math.max(idata.length, 1), 0x1000)
  const rsrc = rsrcFlat(manifests, rsrcRva)
  const headers = Buffer.alloc(FILE_ALIGN)
  headers.write('MZ', 0, 'latin1')
  headers.writeUInt32LE(0x40, 0x3c)
  headers.write('PE\0\0', 0x40, 'latin1')
  const coff = 0x44
  headers.writeUInt16LE(0x8664, coff)
  headers.writeUInt16LE(2, coff + 2)
  headers.writeUInt16LE(240, coff + 16)
  headers.writeUInt16LE(0x22, coff + 18)
  const opt = coff + 20
  headers.writeUInt16LE(0x20b, opt)
  headers.writeUInt16LE(subsystem, opt + 68)
  headers.writeUInt32LE(16, opt + 108)
  const dirBase = opt + 112
  headers.writeUInt32LE(idataRva, dirBase + 8)
  headers.writeUInt32LE(idata.length, dirBase + 12)
  headers.writeUInt32LE(rsrcRva, dirBase + 16)
  headers.writeUInt32LE(rsrc.length, dirBase + 20)
  const idataRaw = FILE_ALIGN
  const rsrcRaw = idataRaw + align(idata.length, FILE_ALIGN)
  const sec = (i, name, rva, size, raw) => {
    const at = opt + 240 + i * 40
    headers.write(name, at, 'latin1')
    headers.writeUInt32LE(size, at + 8)
    headers.writeUInt32LE(rva, at + 12)
    headers.writeUInt32LE(align(size, FILE_ALIGN), at + 16)
    headers.writeUInt32LE(raw, at + 20)
  }
  sec(0, '.idata', idataRva, idata.length, idataRaw)
  sec(1, '.rsrc', rsrcRva, rsrc.length, rsrcRaw)
  const pad = (b) => Buffer.concat([b, Buffer.alloc(align(b.length, FILE_ALIGN) - b.length)])
  return Buffer.concat([headers, pad(idata), pad(rsrc)])
}

/** The same exe with `from` replaced by `to` (the patch is zero-padded to the original's length). */
function patched(pe, from, to) {
  const out = Buffer.from(pe)
  const at = out.indexOf(from)
  assert.ok(at >= 0, `${from} not found in the fixture`)
  Buffer.alloc(from.length).copy(out, at)
  Buffer.from(to).copy(out, at)
  return out
}

// ---- scratch folders ------------------------------------------------------------------------------------------------

const created = []

function scratch(name) {
  const dir = path.join(SCRATCH, `${name}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`)
  fs.mkdirSync(dir, { recursive: true })
  created.push(dir)
  return dir
}

after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true })
})

function writeFile(dir, rel, data) {
  const file = path.join(dir, rel)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data)
  return file
}

const LOADER_BYTES = Buffer.from('a stand-in for WebView2Loader.dll')
const LOADER_SHA256 = crypto.createHash('sha256').update(LOADER_BYTES).digest('hex')
const goodConfig = (extra = {}) => ({
  productName: 'nq-lab terminal', version: '0.1.0', identifier: IDENTIFIER,
  bundle: { active: true, targets: ['nsis'], createUpdaterArtifacts: false,
    windows: { webviewInstallMode: { type: 'embedBootstrapper', silent: true }, nsis: { installMode: 'currentUser', installerHooks: HOOKS_CONFIG_PATH } } },
  ...extra,
})
const nsi = (lines = []) => [
  '!define INSTALLMODE "currentUser"', '!define INSTALLWEBVIEW2MODE "embedBootstrapper"', `!define WEBVIEW2BOOTSTRAPPERPATH "${BOOTSTRAPPER_PATH}"`, 'RequestExecutionLevel user',
  '${GetOptions} $CMDLINE "/NS" $NoShortcutMode', `!include "${HOOKS_INCLUDE}"`, '!insertmacro MUI_PAGE_DIRECTORY', 'SetOutPath $INSTDIR', 'File "${MAINBINARYSRCPATH}"',
  'File /a "/oname=WebView2Loader.dll" "D:\\dev\\targets\\x\\release\\WebView2Loader.dll"', ...lines].join('\n')

/** A clean release folder in the layout of build-release.ps1 (the exe carries its identifier, as a built one does). */
function cleanRelease(dir, { exe = buildPe(), config = goodConfig(), identifier = IDENTIFIER, provenance = { webview2_bootstrapper: goodBootstrapper() }, hooks = realHooks() } = {}) {
  writeFile(dir, 'payload/release/nq-lab-terminal.exe', Buffer.concat([exe, Buffer.from(`\0${identifier}\0`)]))
  writeFile(dir, 'config/tauri.conf.json', JSON.stringify(config))
  writeFile(dir, 'nq-lab terminal_0.1.0_x64-setup.exe', buildPe({ imports: ['KERNEL32.dll', 'user32.dll'] }))
  writeFile(dir, 'nsis/release/installer.nsi', nsi())
  if (hooks !== null) writeFile(dir, 'nsis/release/hooks.nsh', hooks)
  writeFile(dir, 'PROVENANCE.json', JSON.stringify(provenance))
  return dir
}
const OPTIONS = { loaderSha256: LOADER_SHA256 }
const realHooks = () => fs.readFileSync(HOOKS_FILE, 'utf8')

// ---- the guards --------------------------------------------------------------------------------------------------------

test('the clean fixture exe passes the manifest and import rules', () => {
  const file = writeFile(scratch('exe'), 'a.exe', buildPe())
  assert.deepEqual(exeProblems(file, { loaderFile: null, loaderSha256: null, allowLoader: true }), [])
})

test('an exe whose manifest lost PerMonitorV2 fails', () => {
  const file = writeFile(scratch('exe'), 'a.exe', buildPe({ manifests: [MANIFEST.replace(/PerMonitorV2/g, 'unaware')] }))
  assert.match(exeProblems(file, OPTIONS).join('\n'), /dpiAwareness is unaware/)
})

test('an exe whose manifest lost Common-Controls 6.0 fails', () => {
  const file = writeFile(scratch('exe'), 'a.exe', buildPe({ manifests: [MANIFEST.replace(/6\.0\.0\.0/g, '5.0.0.0')] }))
  assert.match(exeProblems(file, OPTIONS).join('\n'), /Common-Controls/)
})

test('an exe that asks for administrator fails', () => {
  const file = writeFile(scratch('exe'), 'a.exe', buildPe({ manifests: [MANIFEST.replace('asInvoker', 'requireAdministrator')] }))
  assert.match(exeProblems(file, OPTIONS).join('\n'), /requireAdministrator/)
})

test('an exe with two manifests (the W0A linker result) fails', () => {
  const second = '<assembly><trustInfo><security><requestedPrivileges><requestedExecutionLevel level="asInvoker"/></requestedPrivileges></security></trustInfo></assembly>'
  const file = writeFile(scratch('exe'), 'a.exe', buildPe({ manifests: [MANIFEST, second] }))
  assert.match(exeProblems(file, OPTIONS).join('\n'), /2 RT_MANIFEST/)
})

test('a copy importing libwinpthread-1.dll fails', () => {
  const bad = patched(buildPe(), 'api-ms-win-core-synch-l1-2-0.dll', 'libwinpthread-1.dll')
  const file = writeFile(scratch('exe'), 'a.exe', bad)
  assert.match(exeProblems(file, OPTIONS).join('\n'), /libwinpthread-1\.dll/)
})

for (const dll of ['libgcc_s_seh-1.dll', 'libstdc++-6.dll', 'evil_helper_library.dll']) {
  test(`an exe importing ${dll} fails`, () => {
    const file = writeFile(scratch('exe'), 'a.exe', patched(buildPe(), 'api-ms-win-core-synch-l1-2-0.dll', dll))
    assert.match(exeProblems(file, OPTIONS).join('\n'), new RegExp(dll.replace(/[.+]/g, '\\$&')))
  })
}

test('WebView2Loader.dll is allowed only when the file beside the exe has the pinned hash', () => {
  const dir = scratch('loader')
  const exe = writeFile(dir, 'a.exe', buildPe({ imports: [...GOOD_IMPORTS, 'WebView2Loader.dll'] }))
  const loader = writeFile(dir, 'WebView2Loader.dll', LOADER_BYTES)
  assert.deepEqual(exeProblems(exe, { loaderFile: loader, loaderSha256: LOADER_SHA256 }), [])
  fs.writeFileSync(loader, 'a different file')
  assert.match(exeProblems(exe, { loaderFile: loader, loaderSha256: LOADER_SHA256 }).join('\n'), /WebView2Loader\.dll.*pinned/)
  assert.match(exeProblems(exe, { loaderFile: path.join(dir, 'missing.dll'), loaderSha256: LOADER_SHA256 }).join('\n'), /WebView2Loader\.dll/)
})

test('the pinned loader hash is the one check.ps1 pins', () => {
  const checkPs1 = fs.readFileSync(path.join(HERE, '..', 'check.ps1'), 'utf8')
  const pinned = /\$LoaderSha256 = '([0-9A-Fa-f]{64})'/.exec(checkPs1)
  assert.ok(pinned, 'check.ps1 no longer pins the loader')
  assert.equal(PINNED_LOADER_SHA256, pinned[1].toLowerCase())
})

test('the real spike exe whose manifest lost an entry fails', { skip: !fs.existsSync(SPIKE_EXE) }, () => {
  const problems = exeProblems(SPIKE_EXE, { loaderFile: null, loaderSha256: null, allowLoader: true })
  assert.match(problems.join('\n'), /RT_MANIFEST|PerMonitorV2|Common-Controls/)
})

// ---- lab data in the artefact ------------------------------------------------------------------------------------------

test('a .parquet file fails, whatever its folder', () => {
  assert.match(pathProblems(['payload/release/NQ.V.0_1m.parquet']).join('\n'), /parquet/)
  assert.match(pathProblems(['a/b/C.PARQUET']).join('\n'), /parquet/)
})

for (const bad of ['results/ledger.csv', 'data/raw/x.bin', 'live/volmanaged_paper.py', 'backtests/output/r1/result.json',
  'payload/results/x.txt', 'Results/x.txt', 'results\\registry.csv']) {
  test(`a path under data, results, live or backtests/output fails: ${bad}`, () => {
    assert.equal(pathProblems([bad]).length > 0, true)
  })
}

for (const bad of ['SEALED_RESULT.md', 'qa_sealed.json', 'x/sealed/y.json', 'oos_access_log.jsonl', 'oos_openings.json']) {
  test(`a file named like a sealed result fails: ${bad}`, () => {
    assert.equal(pathProblems([bad]).length > 0, true)
  })
}

test('the shipped file names pass the path rules', () => {
  const names = ['payload/release/nq-lab-terminal.exe', 'payload/release/WebView2Loader.dll', 'nq-lab terminal_0.1.0_x64-setup.exe',
    'nsis/release/installer.nsi', 'SHA256SUMS', 'PROVENANCE.json', 'resources/assets/splash.html']
  assert.deepEqual(pathProblems(names), [])
})

test('a planted .parquet in a clean release folder fails the whole check', () => {
  const dir = cleanRelease(scratch('rel'))
  assert.deepEqual(checkRelease(dir, OPTIONS).problems, [])
  writeFile(dir, 'payload/NQ.V.0_1m.parquet', 'x')
  assert.match(checkRelease(dir, OPTIONS).problems.join('\n'), /parquet/)
})

test('a planted path under results/ in a clean release folder fails the whole check', () => {
  const dir = cleanRelease(scratch('rel'))
  writeFile(dir, 'results/ledger.csv', 'x')
  assert.match(checkRelease(dir, OPTIONS).problems.join('\n'), /results/)
})

test('an installer script that installs a lab path fails', () => {
  const dir = cleanRelease(scratch('rel'))
  writeFile(dir, 'nsis/release/installer.nsi', nsi(['File /a "/oname=$INSTDIR\\results\\ledger.csv" "C:\\x\\ledger.csv"']))
  assert.match(checkRelease(dir, OPTIONS).problems.join('\n'), /results/)
})

test('listFiles returns forward-slash relative paths', () => {
  const dir = cleanRelease(scratch('rel'))
  assert.ok(listFiles(dir).includes('payload/release/nq-lab-terminal.exe'))
})

// ---- the installer -----------------------------------------------------------------------------------------------------

test('an installer that requests asInvoker passes; administrator and a missing manifest fail', () => {
  const dir = scratch('inst')
  const good = writeFile(dir, 'good.exe', buildPe({ imports: ['KERNEL32.dll'] }))
  const admin = writeFile(dir, 'admin.exe', buildPe({ imports: ['KERNEL32.dll'], manifests: [MANIFEST.replace('asInvoker', 'requireAdministrator')] }))
  const none = writeFile(dir, 'none.exe', buildPe({ imports: ['KERNEL32.dll'], manifests: [] }))
  assert.deepEqual(installerProblems(good), [])
  assert.match(installerProblems(admin).join('\n'), /requireAdministrator/)
  assert.match(installerProblems(none).join('\n'), /no RT_MANIFEST|asInvoker/)
})

test('a release folder whose installer asks for administrator fails', () => {
  const dir = cleanRelease(scratch('rel'))
  writeFile(dir, 'nq-lab terminal_0.1.0_x64-setup.exe', buildPe({ imports: ['KERNEL32.dll'], manifests: [MANIFEST.replace('asInvoker', 'requireAdministrator')] }))
  assert.match(checkRelease(dir, OPTIONS).problems.join('\n'), /requireAdministrator/)
})

/// ---- the configuration and the updater ---------------------------------------------------------------------------------
// Tauri 2 compiles the configuration into the exe as Rust data, not as JSON, so there is no JSON to read back from
// the exe. The check reads the configuration files the build used (build-release.ps1 copies them to config/), proves
// the exe belongs to them by its identifier, and scans the exe for the updater plugin itself.

const exeWith = (...strings) => Buffer.from(strings.join('\0'))

test('a configuration with createUpdaterArtifacts false and no updater plugin passes', () => {
  assert.deepEqual(configProblems({ exe: exeWith(IDENTIFIER), config: goodConfig(), name: 'release' }), [])
})

test('a configuration with an updater plugin fails', () => {
  const config = goodConfig({ plugins: { updater: { pubkey: 'k', endpoints: [] } } })
  assert.match(configProblems({ exe: exeWith(IDENTIFIER), config, name: 'release' }).join('\n'), /plugins\.updater/)
})

test('a configuration with createUpdaterArtifacts true, or missing, fails', () => {
  const on = goodConfig(); on.bundle.createUpdaterArtifacts = true
  assert.match(configProblems({ exe: exeWith(IDENTIFIER), config: on, name: 'release' }).join('\n'), /createUpdaterArtifacts/)
  const missing = goodConfig(); delete missing.bundle.createUpdaterArtifacts
  assert.match(configProblems({ exe: exeWith(IDENTIFIER), config: missing, name: 'release' }).join('\n'), /createUpdaterArtifacts/)
})

test('a configuration that is not per-user, or has no embedded bootstrapper, fails', () => {
  const machine = goodConfig(); machine.bundle.windows.nsis.installMode = 'perMachine'
  assert.match(configProblems({ exe: exeWith(IDENTIFIER), config: machine, name: 'release' }).join('\n'), /installMode/)
  const download = goodConfig(); download.bundle.windows.webviewInstallMode.type = 'downloadBootstrapper'
  assert.match(configProblems({ exe: exeWith(IDENTIFIER), config: download, name: 'release' }).join('\n'), /webviewInstallMode/)
})

test('an exe that does not carry the configuration identifier fails (the files are not this exe\'s)', () => {
  assert.match(configProblems({ exe: exeWith('something else'), config: goodConfig(), name: 'release' }).join('\n'), /identifier/)
})

test('an exe with no configuration file beside it fails (nothing proves the claim)', () => {
  assert.match(configProblems({ exe: exeWith(IDENTIFIER), config: null, name: 'release' }).join('\n'), /no configuration/)
})

for (const token of ['tauri-plugin-updater-2.5.0/src/lib.rs', 'tauri_plugin_updater::init', 'plugin:updater|check']) {
  test(`an updater plugin inside the exe fails: ${token}`, () => {
    assert.match(configProblems({ exe: exeWith(IDENTIFIER, token), config: goodConfig(), name: 'release' }).join('\n'), /updater/)
  })
}

for (const token of ['--attach-url', 'DevToolsActivePort', 'NQT_SMOKE_FORCE_PANIC', 'NQT_TEST_POLICY_ROOT']) {
  test(`smoke-build code in the release exe fails: ${token}`, () => {
    assert.match(configProblems({ exe: exeWith(IDENTIFIER, token), config: goodConfig(), name: 'release' }).join('\n'), /smoke-build code/)
  })
}

test('the smoke build may hold its own switches, but a smoke identifier in the release exe fails', () => {
  const smoke = goodConfig({ identifier: `${IDENTIFIER}.smoke` })
  assert.deepEqual(configProblems({ exe: exeWith(`${IDENTIFIER}.smoke`, '--attach-url'), config: smoke, name: 'smoke' }), [])
  assert.match(configProblems({ exe: exeWith(`${IDENTIFIER}.smoke`), config: goodConfig(), name: 'release' }).join('\n'), /identifier of the smoke build/)
})

test('a smoke exe filed under payload/release fails the whole check', () => {
  const dir = cleanRelease(scratch('rel'))
  fs.appendFileSync(path.join(dir, 'payload/release/nq-lab-terminal.exe'), '\0--attach-url\0')
  assert.match(checkRelease(dir, OPTIONS).problems.join('\n'), /smoke-build code/)
})

test('a release folder whose configuration has an updater plugin fails the whole check', () => {
  const dir = cleanRelease(scratch('rel'), { config: goodConfig({ plugins: { updater: { endpoints: [] } } }) })
  assert.match(checkRelease(dir, OPTIONS).problems.join('\n'), /plugins\.updater/)
})

test('a release folder whose exe embeds an updater plugin fails the whole check', () => {
  const dir = cleanRelease(scratch('rel'))
  const exe = path.join(dir, 'payload/release/nq-lab-terminal.exe')
  fs.appendFileSync(exe, '\0tauri-plugin-updater-2.5.0/src/lib.rs\0')
  assert.match(checkRelease(dir, OPTIONS).problems.join('\n'), /updater/)
})

test('a release folder with no release exe fails', () => {
  const dir = cleanRelease(scratch('rel'))
  fs.rmSync(path.join(dir, 'payload/release/nq-lab-terminal.exe'))
  assert.match(checkRelease(dir, OPTIONS).problems.join('\n'), /payload\/release\/nq-lab-terminal\.exe/)
})

test('an installer script without the /NS switch fails', () => {
  const dir = cleanRelease(scratch('rel'))
  writeFile(dir, 'nsis/release/installer.nsi', nsi().replace('/NS', '/XX'))
  assert.match(checkRelease(dir, OPTIONS).problems.join('\n'), /\/NS/)
})

test('an installer script without the folder page fails (the owner could not choose the install folder)', () => {
  const dir = cleanRelease(scratch('rel'))
  writeFile(dir, 'nsis/release/installer.nsi', nsi().replace('!insertmacro MUI_PAGE_DIRECTORY', ''))
  assert.match(checkRelease(dir, OPTIONS).problems.join('\n'), /folder page/)
})

test('an installer script that does not target the current user fails', () => {
  const dir = cleanRelease(scratch('rel'))
  writeFile(dir, 'nsis/release/installer.nsi', nsi().replace('"currentUser"', '"perMachine"'))
  assert.match(checkRelease(dir, OPTIONS).problems.join('\n'), /INSTALLMODE/)
})

// ---- the embedded WebView2 bootstrapper (the installer runs it silently when WebView2 is missing) ------------------------

const bootstrapperProblems = (provenance) => checkRelease(cleanRelease(scratch('rel'), { provenance }), OPTIONS).problems.join(' ')

test('a provenance with a validly signed Microsoft bootstrapper entry passes', () => {
  assert.deepEqual(checkRelease(cleanRelease(scratch('rel')), OPTIONS).problems, [])
})

test('a provenance with no bootstrapper entry fails', () => {
  assert.match(bootstrapperProblems({}), /webview2_bootstrapper/)
})

test('a bootstrapper whose signature is not Valid fails', () => {
  assert.match(bootstrapperProblems({ webview2_bootstrapper: goodBootstrapper({ signature_status: 'HashMismatch' }) }), /HashMismatch/)
})

test('a bootstrapper signed by someone other than Microsoft Corporation fails', () => {
  assert.match(bootstrapperProblems({ webview2_bootstrapper: goodBootstrapper({ signer: 'CN=Someone Else, O=Someone Else' }) }), /Microsoft Corporation/)
})

test('a bootstrapper entry without a sha256 fails', () => {
  assert.match(bootstrapperProblems({ webview2_bootstrapper: goodBootstrapper({ sha256: 'abc' }) }), /sha256/)
})

test('a bootstrapper entry for a different file than the installer script embeds fails', () => {
  assert.match(bootstrapperProblems({ webview2_bootstrapper: goodBootstrapper({ path: String.raw`C:\elsewhere\MicrosoftEdgeWebview2Setup.exe` }) }), /embeds/)
})

test('a missing PROVENANCE.json fails the whole check', () => {
  const dir = cleanRelease(scratch('rel'))
  fs.rmSync(path.join(dir, 'PROVENANCE.json'))
  assert.match(checkRelease(dir, OPTIONS).problems.join(' '), /PROVENANCE\.json/)
})

// ---- the installer hooks (the protected install folder, CWE-427 and CWE-732) ----------------------------------------------
// The installer script includes windows/nsis/hooks.nsh (bundle.windows.nsis.installerHooks). The compiled installer is
// compressed, so the proof that the hooks are in it is the generated script's include, the configuration that asked for
// it and the hooks file's own text (kept beside the script in the release folder, or the include path when it exists).

const hookText = () => realHooks()
const hookProblems = (text) => hooksProblems(text, 'release').join('\n')

test('the shipped hooks file passes the hook rules', () => {
  assert.deepEqual(hooksProblems(hookText(), 'release'), [])
})

for (const macro of ['NSIS_HOOK_PREINSTALL', 'NSIS_HOOK_POSTINSTALL']) {
  test(`hooks without ${macro} fail`, () => {
    assert.match(hookProblems(hookText().replaceAll(macro, 'NSIS_HOOK_RENAMED')), new RegExp(macro))
  })
}

test('hooks whose before-install macro does not protect the folder fail', () => {
  assert.match(hookProblems(hookText().replaceAll('NqtProtectInstallDir', 'NqtNothing')), /NqtProtectInstallDir/)
})

test('hooks whose after-install macro does not verify the folder fail', () => {
  assert.match(hookProblems(hookText().replaceAll('NqtVerifyInstallDir', 'NqtNothing')), /NqtVerifyInstallDir/)
})

test('hooks that start icacls through the search path fail', () => {
  const bare = hookText().replaceAll('"$SYSDIR\\icacls.exe"', 'icacls')
  assert.match(hookProblems(bare), /icacls/)
})

test('hooks that start a shell or ExecWait fail', () => {
  assert.match(hookProblems(`${hookText()}\nExecWait 'cmd /c icacls "$INSTDIR" /grant Users:F'\n`), /ExecWait|cmd/)
  assert.match(hookProblems(`${hookText()}\nExecShell "open" "$INSTDIR"\n`), /ExecShell|shell/i)
})

for (const principal of ['*S-1-1-0', '*S-1-5-11', '*S-1-5-32-545', 'Everyone', 'Users', '"Authenticated Users"']) {
  test(`hooks that grant ${principal} fail`, () => {
    assert.match(hookProblems(`${hookText()}\nnsExec::ExecToStack '"$SYSDIR\\icacls.exe" "$INSTDIR" /grant ${principal}:(OI)(CI)M'\n`), /broad|grant/i)
  })
}

test('hooks that leave inheritance on fail', () => {
  assert.match(hookProblems(hookText().replaceAll('/inheritance:r', '/inheritance:e')), /inheritance/)
})

for (const sid of ['S-1-5-18', 'S-1-5-32-544']) {
  test(`hooks that do not name ${sid} fail`, () => {
    assert.match(hookProblems(hookText().replaceAll(sid, 'S-1-5-19')), new RegExp(sid))
  })
}

for (const token of ['GetFullPathNameW', 'GetDriveTypeW', '$WINDIR', '$PROGRAMFILES64', '$PROGRAMFILES32', 'GetFileAttributesW']) {
  test(`hooks without the refusal rule using ${token} fail`, () => {
    assert.match(hookProblems(hookText().replaceAll(token, 'x')), /refus/i)
  })
}

test('hooks that do not move the default folder under Programs fail (the folder page and the silent install)', () => {
  assert.match(hookProblems(hookText().replaceAll('NqtDefaultUnderPrograms', 'NqtNothing')), /default folder/)
  assert.match(hookProblems(hookText().replace('!define MUI_CUSTOMFUNCTION_GUIINIT', '!define MUI_CUSTOMFUNCTION_RENAMED')), /default folder/)
  assert.match(hookProblems(`${hookText()}\nFunction .onGUIInit\nFunctionEnd\n`), /second \.onGUIInit/)
  assert.match(hookProblems(hookText().replaceAll('\\Programs\\', '\\Apps\\')), /default folder/)
})

test('hooks that never read the icacls exit code fail', () => {
  assert.match(hookProblems(hookText().replaceAll('nsExec::ExecToStack', 'nsExec::Exec')), /exit code|ExecToStack/)
})

test('hooks that remove a folder recursively fail (the uninstaller removes only what was written)', () => {
  assert.match(hookProblems(`${hookText()}\nRMDir /r "$INSTDIR"\n`), /RMDir \/r/)
})

test('a configuration without installerHooks fails', () => {
  const config = goodConfig(); delete config.bundle.windows.nsis.installerHooks
  assert.match(configProblems({ exe: exeWith(IDENTIFIER), config, name: 'release' }).join('\n'), /installerHooks/)
})

test('a release folder whose configuration has no installerHooks fails the whole check', () => {
  const config = goodConfig(); delete config.bundle.windows.nsis.installerHooks
  assert.match(checkRelease(cleanRelease(scratch('rel'), { config }), OPTIONS).problems.join('\n'), /installerHooks/)
})

test('an installer script that does not include the hooks fails', () => {
  const dir = cleanRelease(scratch('rel'))
  writeFile(dir, 'nsis/release/installer.nsi', nsi().replace(`!include "${HOOKS_INCLUDE}"`, ''))
  assert.match(checkRelease(dir, OPTIONS).problems.join('\n'), /does not include the installer hooks/)
})

test('a release folder with hooks that are not protective fails the whole check', () => {
  const dir = cleanRelease(scratch('rel'), { hooks: hookText().replaceAll('/inheritance:r', '/inheritance:e') })
  assert.match(checkRelease(dir, OPTIONS).problems.join('\n'), /inheritance/)
})

test('a release folder with no hooks file, and no include path to read, fails', () => {
  const dir = cleanRelease(scratch('rel'), { hooks: null })
  assert.match(checkRelease(dir, OPTIONS).problems.join('\n'), /hooks file/)
})

test('a missing hooks copy falls back to the include path when that file exists', () => {
  const dir = cleanRelease(scratch('rel'), { hooks: null })
  writeFile(dir, 'nsis/release/installer.nsi', nsi().replace(HOOKS_INCLUDE, HOOKS_FILE))
  assert.deepEqual(checkRelease(dir, OPTIONS).problems, [])
})

test('the measure build is held to the same hook rules', () => {
  const dir = cleanRelease(scratch('rel'))
  const measure = goodConfig({ identifier: `${IDENTIFIER}.measure` })
  writeFile(dir, 'config/tauri.measure.conf.json', JSON.stringify({ identifier: `${IDENTIFIER}.measure` }))
  writeFile(dir, 'payload/measure/nq-lab-terminal.exe', Buffer.concat([buildPe(), Buffer.from(`\0${measure.identifier}\0`)]))
  writeFile(dir, 'nsis/measure/installer.nsi', nsi())
  writeFile(dir, 'nsis/measure/hooks.nsh', hookText().replaceAll('/inheritance:r', '/inheritance:e'))
  assert.match(checkRelease(dir, OPTIONS).problems.join('\n'), /measure: .*inheritance/)
})

// ---- the install-test build (the renamed product that install-test.ps1 installs beside a real install) ----------------------

const INSTALLTEST_ID = `${IDENTIFIER}.installtest`
function addInstallTest(dir, { hooks = realHooks(), exeExtra = '', script = nsi() } = {}) {
  writeFile(dir, 'config/tauri.installtest.conf.json', JSON.stringify({ productName: 'nq-lab terminal installtest', identifier: INSTALLTEST_ID }))
  writeFile(dir, 'payload/installtest/nq-lab-terminal.exe', Buffer.concat([buildPe(), Buffer.from(`\0${INSTALLTEST_ID}\0${exeExtra}`)]))
  writeFile(dir, 'nsis/installtest/installer.nsi', script)
  writeFile(dir, 'nsis/installtest/hooks.nsh', hooks)
  writeFile(dir, 'nq-lab terminal installtest_0.1.0_x64-setup.exe', buildPe({ imports: ['KERNEL32.dll', 'user32.dll'] }))
  return dir
}

test('a release folder that also holds the install-test build passes and says it checked it', () => {
  const result = checkRelease(addInstallTest(cleanRelease(scratch('rel'))), OPTIONS)
  assert.deepEqual(result.problems, [])
  assert.match(result.notes.join('\n'), /installtest/)
})

test('the install-test build is held to the same hook rules', () => {
  const dir = addInstallTest(cleanRelease(scratch('rel')), { hooks: realHooks().replaceAll('/inheritance:r', '/inheritance:e') })
  assert.match(checkRelease(dir, OPTIONS).problems.join('\n'), /installtest: .*inheritance/)
})

test('an install-test exe that holds smoke-build code fails', () => {
  const dir = addInstallTest(cleanRelease(scratch('rel')), { exeExtra: '--attach-url' })
  assert.match(checkRelease(dir, OPTIONS).problems.join('\n'), /installtest: the exe holds smoke-build code/)
})

test('an install-test installer script that embeds another bootstrapper than the recorded one fails', () => {
  const dir = addInstallTest(cleanRelease(scratch('rel')), { script: nsi().replace(BOOTSTRAPPER_PATH, 'D:\\other\\MicrosoftEdgeWebview2Setup.exe') })
  assert.match(checkRelease(dir, OPTIONS).problems.join('\n'), /installtest: the installer script embeds/)
})

test('a release exe that carries the install-test identifier fails', () => {
  const dir = cleanRelease(scratch('rel'), { exe: Buffer.concat([buildPe(), Buffer.from(`\0${INSTALLTEST_ID}\0`)]) })
  assert.match(checkRelease(dir, OPTIONS).problems.join('\n'), /release: the exe carries the identifier of the installtest build/)
})

// ---- the command line --------------------------------------------------------------------------------------------------

function run(args, env = {}) {
  return spawnSync(process.execPath, [CHECK, ...args], { encoding: 'utf8', windowsHide: true, env: { ...process.env, ...env } })
}

test('the command line exits 1 on a planted .parquet and 0 on the clean folder', () => {
  const dir = cleanRelease(scratch('cli'))
  const ok = run([dir])
  assert.equal(ok.status, 0, ok.stdout + ok.stderr)
  writeFile(dir, 'x/y.parquet', 'x')
  const bad = run([dir])
  assert.equal(bad.status, 1, bad.stdout + bad.stderr)
  assert.match(bad.stderr + bad.stdout, /parquet/)
})

test('--tree checks an installed folder against the path rules only', () => {
  const dir = scratch('tree')
  writeFile(dir, 'nq-lab-terminal.exe', 'x')
  writeFile(dir, 'uninstall.exe', 'x')
  assert.equal(run(['--tree', dir]).status, 0)
  writeFile(dir, 'results/ledger.csv', 'x')
  assert.equal(run(['--tree', dir]).status, 1)
})

test('the command line exits 2 without a folder', () => {
  assert.equal(run([]).status, 2)
})
