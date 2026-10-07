// Born-failing tests of the build-machine path scan (artefact-check.mjs) and of the path remapping in build-release.ps1.
// The 0.1.2 and 0.2.0 exes held D:\dev\cargo\registry paths (Rust panic locations). A release must hold no drive-letter path
// under D:\dev or C:\Users, in either slash direction, as 8-bit or as UTF-16 text.
//
//   node --test desktop/scripts/tests/machine-paths.test.mjs
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test, { after } from 'node:test'
import { machinePathFindings, machinePathProblems, machinePathScanTargets } from '../artefact-check.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHECK = path.join(HERE, '..', 'artefact-check.mjs')
const BUILD = path.join(HERE, '..', 'build-release.ps1')
const SCRATCH = process.env.NQT_TEST_TMP || 'D:/dev/tmp/machine-paths-tests'
const created = []

function scratchFile(name, content) {
  const dir = path.join(SCRATCH, `mp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`)
  fs.mkdirSync(dir, { recursive: true })
  created.push(dir)
  const file = path.join(dir, name)
  fs.writeFileSync(file, content)
  return file
}
after(() => { for (const dir of created) fs.rmSync(dir, { recursive: true, force: true }) })

const noise = (n) => Buffer.alloc(n, 0x90)
const wrap = (text) => Buffer.concat([noise(64), Buffer.from(`\0${text}\0`, 'latin1'), noise(64)])
const rules = (bytes) => machinePathFindings(bytes).map((f) => f.rule).sort()

test('a clean file has no finding', () => {
  assert.deepEqual(machinePathFindings(wrap('src\\main.rs /cargo/registry/src/index.crates.io/tauri-2.12.1/src/lib.rs /rustc/abc/library/std/src/io.rs')), [])
  assert.deepEqual(machinePathFindings(Buffer.alloc(0)), [])
  assert.deepEqual(machinePathFindings(wrap('C:\\Windows\\System32 D:\\other\\place E:\\dev\\x')), [])
})

test('a planted D:\\dev\\cargo\\registry path is found (born failing)', () => {
  const found = machinePathFindings(wrap('D:\\dev\\cargo\\registry\\src\\index.crates.io-1949cf8c6b5b557f\\tauri-2.12.1\\src\\lib.rs'))
  assert.equal(found.length, 1)
  assert.equal(found[0].rule, 'build-machine-path-dev')
  assert.match(found[0].text, /^D:\\dev\\cargo\\registry/)
})

test('a planted C:\\Users path is found (born failing)', () => {
  const found = machinePathFindings(wrap('C:\\Users\\someone\\nq-lab\\terminal\\desktop\\src-tauri\\src\\main.rs'))
  assert.deepEqual(found.map((f) => f.rule), ['build-machine-path-users'])
})

test('both slash directions, doubled backslashes and any case are found', () => {
  for (const text of ['D:/dev/cargo/registry/src/x', 'd:\\dev\\cargo\\x', 'D:\\\\dev\\\\cargo\\\\x', 'D:/dev\\cargo', 'C:/Users/x/y', 'c:\\users\\x', 'C:\\\\Users\\\\x', 'D:\\dev']) {
    assert.ok(machinePathFindings(wrap(text)).length > 0, text)
  }
})

test('mixed-case planted paths are found: D:\\Dev, D:\\DEV, C:\\USERS, C:\\uSeRs, in both slash directions and as UTF-16 (born failing)', () => {
  for (const text of ['D:\\Dev\\cargo\\registry\\src\\x', 'D:\\DEV\\cargo\\x', 'd:/DEV/cargo/x', 'D:\\dEv', 'C:\\USERS\\someone\\x', 'c:/uSeRs/x', 'C:\\\\USERS\\\\x']) {
    assert.ok(machinePathFindings(wrap(text)).length > 0, text)
  }
  assert.deepEqual(rules(Buffer.concat([noise(10), Buffer.from('D:\\DEV\\cargo', 'utf16le'), noise(10)])), ['build-machine-path-dev'])
  assert.deepEqual(rules(Buffer.concat([noise(11), Buffer.from('C:\\USERS\\x', 'utf16le'), noise(10)])), ['build-machine-path-users'])
  assert.deepEqual(machinePathFindings(wrap('D:\\DEVICES\\x C:\\USERS2\\x D:\\Developer')), [], 'a longer folder name is still not a hit')
})

test('the path is found as UTF-16 text at either alignment', () => {
  const utf16 = Buffer.from('D:\\dev\\cargo\\registry\\src', 'utf16le')
  assert.deepEqual(rules(Buffer.concat([noise(10), utf16, noise(10)])), ['build-machine-path-dev'])
  assert.deepEqual(rules(Buffer.concat([noise(11), utf16, noise(10)])), ['build-machine-path-dev'])
  assert.deepEqual(rules(Buffer.concat([noise(10), Buffer.from('C:\\Users\\x', 'utf16le'), noise(9)])), ['build-machine-path-users'])
})

test('a longer folder name is not a hit: D:\\devices, C:\\Users2', () => {
  assert.deepEqual(machinePathFindings(wrap('D:\\devices\\x C:\\Users2\\x')), [])
})

test('several hits are reported once per distinct path, with a count', () => {
  const found = machinePathFindings(wrap('D:\\dev\\cargo\\a D:\\dev\\cargo\\a D:\\dev\\cargo\\b C:\\Users\\x'))
  assert.equal(found.filter((f) => f.rule === 'build-machine-path-dev').length, 2)
  assert.equal(found.find((f) => f.text === 'D:\\dev\\cargo\\a').count, 2)
  assert.equal(found.filter((f) => f.rule === 'build-machine-path-users').length, 1)
})

test('machinePathProblems names the file and shows the path found', () => {
  const file = scratchFile('a.exe', wrap('D:\\dev\\cargo\\registry\\src\\x\\lib.rs'))
  const [problem, ...rest] = machinePathProblems(file, 'payload/release/a.exe')
  assert.equal(rest.length, 0)
  assert.match(problem, /payload\/release\/a\.exe/)
  assert.match(problem, /D:\\dev\\cargo\\registry/)
  assert.deepEqual(machinePathProblems(scratchFile('b.exe', wrap('/cargo/registry/src')), 'b.exe'), [])
})

function run(args) {
  return spawnSync(process.execPath, [CHECK, ...args], { encoding: 'utf8', windowsHide: true })
}

test('--paths exits 1 on a planted path, 0 on a clean file and 2 on a missing file', () => {
  const bad = scratchFile('bad.exe', wrap('D:/dev/cargo/registry/src/x'))
  const good = scratchFile('good.exe', wrap('/cargo/registry/src/x'))
  assert.equal(run(['--paths', bad]).status, 1)
  assert.match(run(['--paths', bad]).stderr, /D:\/dev\/cargo/)
  assert.equal(run(['--paths', good]).status, 0)
  assert.equal(run(['--paths', good, bad]).status, 1)
  assert.equal(run(['--paths', path.join(SCRATCH, 'missing.exe')]).status, 2)
  assert.equal(run(['--paths']).status, 2)
})

test('--paths scans a folder, every file under it: the extracted payload, not only the installer (born failing)', () => {
  const file = scratchFile('payload-marker.bin', wrap('nothing'))
  const root = path.dirname(file)
  fs.mkdirSync(path.join(root, 'release', 'res'), { recursive: true })
  fs.writeFileSync(path.join(root, 'release', 'nq-lab-terminal.exe'), wrap('/cargo/registry/src/x'))
  fs.writeFileSync(path.join(root, 'release', 'res', 'helper.dll'), wrap('D:\\Dev\\cargo\\registry\\src\\x\\lib.rs'))
  const result = run(['--paths', root])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /release[\\/]res[\\/]helper\.dll/)
  assert.match(result.stderr, /D:\\Dev\\cargo/)
  fs.rmSync(path.join(root, 'release', 'res'), { recursive: true })
  assert.equal(run(['--paths', root]).status, 0)
  assert.equal(run(['--paths', path.join(root, 'no-such-folder')]).status, 2)
})

test('the release check scans every file of the payload folder and every installer, and nothing else', () => {
  const files = ['PROVENANCE.json', 'payload/release/nq-lab-terminal.exe', 'payload/release/WebView2Loader.dll', 'payload/smoke/res/deep.bin', 'payload/installtest/readme.txt',
    'nsis/release/installer.nsi', 'config/tauri.conf.json', 'nq-lab terminal_0.3.0_x64-setup.exe', 'sub/other_x64-setup.exe']
  const installers = ['nq-lab terminal_0.3.0_x64-setup.exe']
  assert.deepEqual(machinePathScanTargets(files, installers).sort(), ['nq-lab terminal_0.3.0_x64-setup.exe', 'payload/installtest/readme.txt', 'payload/release/WebView2Loader.dll',
    'payload/release/nq-lab-terminal.exe', 'payload/smoke/res/deep.bin'])
  assert.deepEqual(machinePathScanTargets([], []), [])
})

// ---- build-release.ps1 remaps the build machine's folders ---------------------------------------------------------------------

const script = fs.readFileSync(BUILD, 'utf8')

function functionText(name) {
  const start = script.indexOf(`function ${name} {`)
  assert.ok(start >= 0, `function ${name} exists`)
  let depth = 0
  for (let i = script.indexOf('{', start); i < script.length; i += 1) {
    if (script[i] === '{') depth += 1
    if (script[i] === '}') { depth -= 1; if (depth === 0) return script.slice(start, i + 1) }
  }
  throw new Error('unbalanced')
}

function powershell(command) {
  return spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], { encoding: 'utf8', windowsHide: true })
}

test('build-release.ps1 sets cargo encoded rustflags with a remap of the cargo home, the rustup home, the source folder and the target folder', () => {
  const body = functionText('Get-RemapFlags')
  assert.match(body, /--remap-path-prefix=/)
  for (const token of ['$env:CARGO_HOME', '$env:RUSTUP_HOME', '$Terminal', '$TargetDir']) assert.ok(body.includes(token), token)
  const env = functionText('Set-BuildEnvironment')
  assert.match(env, /CARGO_ENCODED_RUSTFLAGS/)
  assert.match(env, /\[char\]0x1f/, 'the flags are joined by the unit separator, so a folder name with a space survives')
  assert.match(env, /Get-BuildRustFlags/)
})

test('Set-BuildEnvironment is called before the first cargo call, so every build, tree and version check sees the remap', () => {
  const call = script.indexOf('\nSet-BuildEnvironment\n')
  assert.ok(call > 0)
  assert.ok(call < script.indexOf('\nTest-FeatureTrees\n'))
})

test('Get-RemapFlags builds neutral prefixes, a catch-all first and the specific folders after it, spaces kept', () => {
  const command = [
    functionText('Get-RemapFlags'),
    "$BuildRoot = 'D:\\dev'; $Terminal = 'C:\\Users\\Some One\\repo\\terminal'; $TargetDir = 'D:\\dev\\targets\\release'",
    "$env:CARGO_HOME = 'D:\\dev\\cargo'; $env:RUSTUP_HOME = 'D:\\dev\\rustup'; $env:USERPROFILE = 'C:\\Users\\Some One'",
    'Get-RemapFlags | ForEach-Object { $_ }',
  ].join('\n')
  const out = powershell(command)
  assert.equal(out.status, 0, out.stderr)
  const flags = out.stdout.split(/\r?\n/).filter(Boolean)
  const mapping = (from) => flags.findIndex((f) => f.startsWith(`--remap-path-prefix=${from}=`))
  assert.ok(flags.every((f) => f.startsWith('--remap-path-prefix=')), flags.join('|'))
  for (const from of ['D:\\dev', 'C:\\Users\\Some One', 'D:\\dev\\cargo', 'D:\\dev\\rustup', 'C:\\Users\\Some One\\repo\\terminal', 'D:\\dev\\targets\\release']) assert.ok(mapping(from) >= 0, `${from} in ${flags.join('|')}`)
  assert.ok(mapping('D:\\dev') < mapping('D:\\dev\\cargo'), 'rustc applies the last matching remap, so the catch-all comes first')
  assert.ok(mapping('C:\\Users\\Some One') < mapping('C:\\Users\\Some One\\repo\\terminal'))
  for (const flag of flags) assert.doesNotMatch(flag.split('=').slice(2).join('='), /[A-Za-z]:\\/, `the target of ${flag} is neutral`)
})

test('Get-BuildRustFlags keeps flags that were already set in RUSTFLAGS or CARGO_ENCODED_RUSTFLAGS', () => {
  const body = functionText('Get-BuildRustFlags')
  assert.match(body, /\$env:RUSTFLAGS/)
  assert.match(body, /\$env:CARGO_ENCODED_RUSTFLAGS/)
  const command = [
    functionText('Get-RemapFlags'), body,
    "$BuildRoot = 'D:\\dev'; $Terminal = 'D:\\a'; $TargetDir = 'D:\\dev\\t'; $env:CARGO_HOME = 'D:\\dev\\cargo'; $env:RUSTUP_HOME = 'D:\\dev\\rustup'; $env:USERPROFILE = 'C:\\Users\\u'",
    "$env:RUSTFLAGS = '-C target-cpu=native'; Remove-Item env:CARGO_ENCODED_RUSTFLAGS -ErrorAction SilentlyContinue",
    "(Get-BuildRustFlags) -join '|'",
  ].join('\n')
  const out = powershell(command)
  assert.equal(out.status, 0, out.stderr)
  assert.match(out.stdout, /^-C\|target-cpu=native\|--remap-path-prefix=/)
})

test('every payload copied by build-release.ps1 is scanned for build-machine paths and a hit fails the build', () => {
  const body = functionText('Test-MachinePaths')
  assert.match(body, /artefact-check\.mjs/)
  assert.match(body, /--paths/)
  assert.match(body, /Add-Failure/)
  const copy = functionText('Copy-Payload')
  assert.match(copy, /Test-MachinePaths/)
})

test('the header documents the remap and the scan', () => {
  const header = script.split('[CmdletBinding()]')[0]
  assert.match(header, /remap-path-prefix/)
  assert.match(header, /D:\\dev/)
})

// ---- a shipped source never holds a build-machine folder as a literal ------------------------------------------------------------

const RUST_SOURCES = path.join(HERE, '..', '..', 'src-tauri', 'src')

function rustFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return rustFiles(full)
    return entry.name.endsWith('.rs') ? [full] : []
  })
}

/** The part of a Rust file that is compiled into the shipped exe: before the unit-test module, without comment lines. */
function shippedCode(text) {
  const end = text.indexOf('#[cfg(test)]')
  const code = end >= 0 ? text.slice(0, end) : text
  return code.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n')
}

/** Files that a source declares as a unit-test module of its own: `#[cfg(test)]` then `#[path = "name.rs"]`. They are never compiled into the shipped exe. */
function testOnlyFiles(files) {
  const declared = new Set()
  for (const file of files) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/#\[cfg\(test\)\]\s*#\[path = "([^"]+\.rs)"\]/g)) declared.add(match[1])
  }
  return declared
}

test('a unit-test module kept in a file of its own is declared under cfg(test), so the literal scan may skip it and nothing else', () => {
  const declared = testOnlyFiles(rustFiles(RUST_SOURCES))
  assert.ok(declared.has('window_tests.rs'), 'window.rs declares window_tests.rs under cfg(test)')
  for (const name of declared) {
    assert.ok(fs.existsSync(path.join(RUST_SOURCES, name)), `${name} exists next to the sources`)
  }
})

test('no shipped Rust code holds a D:\\dev or C:\\Users literal: it would sit in rodata, missed by the scan only when a letter follows it (born failing)', () => {
  const files = rustFiles(RUST_SOURCES)
  assert.ok(files.length > 10, 'the Rust sources were found')
  const skipped = testOnlyFiles(files)
  const hits = []
  for (const file of files) {
    if (skipped.has(path.basename(file))) continue
    shippedCode(fs.readFileSync(file, 'utf8')).split('\n').forEach((line, index) => {
      if (/[Dd]:[\\/]+dev(?![A-Za-z0-9_])/.test(line) || /[Cc]:[\\/]+[Uu]sers(?![A-Za-z0-9_])/.test(line)) hits.push(`${path.basename(file)} (code line ${index + 1}): ${line.trim()}`)
    })
  }
  assert.deepEqual(hits, [])
})

test('the scan reports D:\\dev whatever non-letter byte follows it, so a packed literal cannot be shipped by luck', () => {
  for (const next of ['\\', '/', ' ', '.', '-', '\0', '\u00ff']) {
    assert.ok(machinePathFindings(Buffer.concat([noise(8), Buffer.from(`D:\\dev${next}`, 'latin1'), noise(8)])).length > 0, JSON.stringify(next))
  }
})
