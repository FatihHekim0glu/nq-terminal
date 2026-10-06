// Born-failing tests of the installer hooks (desktop/src-tauri/windows/nsis/hooks.nsh; 03 sections 13.1 and 14,
// 04 D5.4; CWE-427 and CWE-732). A small installer is compiled from a stub that includes the hooks the way the Tauri
// template does (near the top, before the defines) and inserts NSIS_HOOK_PREINSTALL and NSIS_HOOK_POSTINSTALL where
// the template does. It runs silently, per user, against folders under D:\dev\tmp, so the whole proof takes seconds;
// install-test.ps1 repeats the scenarios against the real built installer.
//
//   node --test desktop/scripts/tests/install-hooks.test.mjs
//
// A drive-root target is a SUBST drive pointing at a scratch folder, so a guard that fails writes only there.
// Nothing here starts the app or shows a window (the stub is SilentInstall silent), and the registry key the stub
// writes is its own (HKCU\Software\nqlab-hooks-test).
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test, { after, before } from 'node:test'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const HOOKS = path.join(HERE, '..', '..', 'src-tauri', 'windows', 'nsis', 'hooks.nsh')
/** The folder with its parent resolved to the real folder: the installer refuses a link or junction in the path, and D:\dev is a junction on a PC whose big folders moved. */
function realFolder(folder) {
  try { return path.join(fs.realpathSync(path.dirname(folder)), path.basename(folder)).replaceAll('\\', '/') } catch { return folder }
}
const ROOT = realFolder(process.env.NQT_TEST_TMP_HOOKS || 'D:/dev/tmp/dec1-hooks-tests')
const SYS = process.env.SystemRoot || 'C:\\Windows'
const ICACLS = path.join(SYS, 'System32', 'icacls.exe')
const POWERSHELL = path.join(SYS, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const REG = path.join(SYS, 'System32', 'reg.exe')
const SUBST = path.join(SYS, 'System32', 'subst.exe')
const MAKENSIS = [process.env.NQT_MAKENSIS, path.join(process.env.LOCALAPPDATA || '', 'tauri', 'NSIS', 'makensis.exe'), 'D:/dev/tauri-tools/NSIS/makensis.exe']
  .filter(Boolean).find((p) => fs.existsSync(p))
const SIDS = { system: 'S-1-5-18', admins: 'S-1-5-32-544', users: 'S-1-5-32-545', everyone: 'S-1-1-0', authenticated: 'S-1-5-11' }
const CODE = { refused: 3, daclFailed: 4, daclWrong: 5 }
const REG_KEY = 'HKCU\\Software\\nqlab-hooks-test'
// NQT_STUB_WITHOUT_HOOKS=1 compiles the stub without the hooks: the born-failing proof that every scenario below fails then.
const WITHOUT_HOOKS = process.env.NQT_STUB_WITHOUT_HOOKS === '1'
const NO_MAKENSIS = MAKENSIS ? false : 'makensis (the NSIS the Tauri bundler downloads) is not on this PC'

const run = (file, args, options = {}) => spawnSync(file, args, { encoding: 'utf8', windowsHide: true, ...options })
const unique = (name) => path.join(ROOT, `${name}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`)
const win = (p) => p.replace(/\//g, '\\')
const created = []
let lastOutput = ''
const substs = []

// ---- the stub installer ---------------------------------------------------------------------------------------------------

// OTHER_OWNER is the owner rule's compile-time test seam (NQT_TEST_OWNER_SID in hooks.nsh): the stub names a principal other
// than the one running it as the only account allowed to own the install folder, so a folder or file the test user created
// looks planted by someone else. The real installer never defines it. A foreign owner cannot be built any other way without
// an administrator (setting an owner needs a privilege that only an elevated account holds).
const OTHER_OWNER = 'S-1-5-21-111111111-222222222-333333333-1001'

function stubScript(outFile, payload, tamper, ownerProbe) {
  const lines = [
    'Unicode true', 'RequestExecutionLevel user', 'SilentInstall silent', 'ShowInstDetails nevershow',
    ...(ownerProbe && !WITHOUT_HOOKS ? [`!define NQT_TEST_OWNER_SID "${OTHER_OWNER}"`] : []),
    '!include MUI2.nsh', '!include LogicLib.nsh', ...(WITHOUT_HOOKS ? [] : [`!include "${win(HOOKS)}"`]),
    '!define MAINBINARYNAME "stub-app"', '!define UNINSTKEY "Software\\nqlab-hooks-test\\uninst"', '!define MANUPRODUCTKEY "Software\\nqlab-hooks-test\\product"',
    'Name "stub"', `OutFile "${win(outFile)}"`, 'InstallDir "D:\\dev\\tmp\\dec1-hooks-tests\\fallback-never-used"',
    'Section Install', '  SetOutPath $INSTDIR', '  !ifmacrodef NSIS_HOOK_PREINSTALL', '    !insertmacro NSIS_HOOK_PREINSTALL', '  !endif',
    `  File "/oname=stub-app.exe" "${win(payload)}"`, `  File "/oname=WebView2Loader.dll" "${win(payload)}"`, '  WriteUninstaller "$INSTDIR\\uninstall.exe"',
    '  WriteRegStr SHCTX "${UNINSTKEY}" "InstallLocation" $INSTDIR', '  WriteRegStr SHCTX "${MANUPRODUCTKEY}" "" $INSTDIR',
  ]
  if (tamper === 'folder') lines.push('  nsExec::ExecToStack \'"$SYSDIR\\icacls.exe" "$INSTDIR" /grant *S-1-5-32-545:(OI)(CI)R /Q\'', '  Pop $0', '  Pop $0')
  if (tamper === 'file') lines.push('  nsExec::ExecToStack \'"$SYSDIR\\icacls.exe" "$INSTDIR\\stub-app.exe" /grant *S-1-1-0:R /Q\'', '  Pop $0', '  Pop $0')
  lines.push('  !ifmacrodef NSIS_HOOK_POSTINSTALL', '    !insertmacro NSIS_HOOK_POSTINSTALL', '  !endif', 'SectionEnd', 'Section Uninstall', 'SectionEnd', '')
  return lines.join('\r\n')
}

function compile(name, tamper, ownerProbe = false) {
  const dir = unique(`stub-${name}`)
  fs.mkdirSync(dir, { recursive: true })
  created.push(dir)
  const payload = path.join(dir, 'payload.bin')
  fs.writeFileSync(payload, 'a stand-in for the app')
  const out = path.join(dir, 'stub-setup.exe')
  const script = path.join(dir, 'stub.nsi')
  fs.writeFileSync(script, stubScript(out, payload, tamper, ownerProbe))
  const built = run(MAKENSIS, ['/V2', script], { env: { ...process.env, TEMP: ROOT, TMP: ROOT } })
  assert.equal(built.status, 0, `makensis failed:\n${built.stdout}\n${built.stderr}`)
  return out
}

/** Runs a compiled stub silently (the folder is the last argument, unquoted, as NSIS requires). */
function install(exe, target) {
  const result = spawnSync(exe, [`/S /D=${target}`], { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true, env: { ...process.env, TEMP: ROOT, TMP: ROOT } })
  assert.equal(result.error, undefined, `the installer did not start: ${result.error}`)
  lastOutput = `${result.stdout}${result.stderr}`.trim()
  return result.status
}

// ---- reading and planting permissions ---------------------------------------------------------------------------------------

function aclOf(target) {
  const script = '$a = Get-Acl -LiteralPath $env:NQT_P; @{ user = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value; owner = $a.GetOwner([Security.Principal.SecurityIdentifier]).Value; protected = $a.AreAccessRulesProtected; ' +
    'rules = @($a.Access | ForEach-Object { @{ sid = $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value; inherited = $_.IsInherited; type = "$($_.AccessControlType)"; mask = [int]$_.FileSystemRights } }) } | ConvertTo-Json -Depth 4 -Compress'
  const out = run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, NQT_P: win(target) } })
  assert.equal(out.status, 0, `Get-Acl failed on ${target}: ${out.stderr}`)
  const parsed = JSON.parse(out.stdout)
  parsed.rules = [].concat(parsed.rules)
  return parsed
}

const grant = (target, sid, rights, inherit = true) => {
  const out = run(ICACLS, [win(target), '/grant', `*${sid}:${inherit ? '(OI)(CI)' : ''}${rights}`, '/Q'])
  assert.equal(out.status, 0, `icacls grant failed: ${out.stdout}${out.stderr}`)
}

/** A folder under ROOT whose permissions grant Users Modify and Everyone write to what is created in it. */
function plantedParent(name) {
  const dir = unique(name)
  fs.mkdirSync(dir, { recursive: true })
  created.push(dir)
  grant(dir, SIDS.users, 'M')
  grant(dir, SIDS.everyone, 'W')
  return dir
}

const broad = (rules) => rules.filter((r) => [SIDS.users, SIDS.everyone, SIDS.authenticated].includes(r.sid))
const sidSet = (rules) => [...new Set(rules.map((r) => r.sid))].sort()

function assertProtected(target) {
  const acl = aclOf(target)
  assert.equal(acl.protected, true, `${target} still inherits`)
  assert.equal(acl.rules.some((r) => r.inherited), false, `${target} holds an inherited rule: ${JSON.stringify(acl.rules)}`)
  assert.deepEqual(sidSet(acl.rules), [...new Set([acl.user, SIDS.system, SIDS.admins])].sort())
  assert.equal(acl.rules.every((r) => r.type === 'Allow'), true)
  assertTrustedOwner(target)
}

/** The owner of a folder or file may only be the installing user, Administrators or SYSTEM: the owner can always rewrite the DACL (CWE-732). */
function assertTrustedOwner(target) {
  const acl = aclOf(target)
  assert.equal([acl.user, SIDS.system, SIDS.admins].includes(acl.owner), true, `${target} is owned by ${acl.owner}`)
}

const elevated = () => run(POWERSHELL, ['-NoProfile', '-Command', '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)']).stdout.trim() === 'True'
const regKeyExists = () => run(REG, ['query', `${REG_KEY}\\uninst`]).status === 0

// ---- set-up -------------------------------------------------------------------------------------------------------------------

let plain
let ownerProbe
let folderTamper
let fileTamper

before(() => {
  if (NO_MAKENSIS) return
  fs.mkdirSync(ROOT, { recursive: true })
  plain = compile('plain')
  ownerProbe = compile('owner-probe', undefined, true)
  folderTamper = compile('folder-tamper', 'folder')
  fileTamper = compile('file-tamper', 'file')
})

after(() => {
  for (const letter of substs) run(SUBST, [`${letter}:`, '/D'])
  run(REG, ['delete', REG_KEY, '/f'])
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true })
})

const onlyHere = { skip: NO_MAKENSIS }

// ---- the planted permissions are real (so the next tests can fail) ------------------------------------------------------------------

test('a folder created under the planted parent inherits Users Modify and Everyone write (the plant works)', onlyHere, () => {
  const child = path.join(plantedParent('plant'), 'child')
  fs.mkdirSync(child)
  const acl = aclOf(child)
  assert.equal(broad(acl.rules).filter((r) => r.inherited).length >= 2, true, JSON.stringify(acl.rules))
})

// ---- a custom folder ends protected -------------------------------------------------------------------------------------------------

test('a custom folder under a parent that grants Users Modify and Everyone write ends with exactly the three principals', onlyHere, () => {
  const target = path.join(plantedParent('custom'), 'app dir')
  assert.equal(install(plain, win(target)), 0)
  assert.equal(fs.existsSync(path.join(target, 'stub-app.exe')), true)
  assertProtected(target)
  for (const file of ['stub-app.exe', 'WebView2Loader.dll', 'uninstall.exe']) {
    const acl = aclOf(path.join(target, file))
    assert.deepEqual(broad(acl.rules), [], `${file}: ${JSON.stringify(acl.rules)}`)
    assertTrustedOwner(path.join(target, file))
  }
  assert.equal(regKeyExists(), true)
  run(REG, ['delete', REG_KEY, '/f'])
})

test('an existing folder with explicit Users and Everyone rules and an old exe ends with exactly the three principals', onlyHere, () => {
  const target = path.join(plantedParent('existing'), 'app')
  fs.mkdirSync(target)
  grant(target, SIDS.users, 'M')
  grant(target, SIDS.everyone, 'W')
  const old = path.join(target, 'stub-app.exe')
  fs.writeFileSync(old, 'an old copy')
  grant(old, SIDS.everyone, 'F', false)
  assert.equal(install(plain, win(target)), 0)
  assertProtected(target)
  assert.deepEqual(broad(aclOf(old).rules), [])
  run(REG, ['delete', REG_KEY, '/f'])
})

test('a second install over the first keeps the protected folder', onlyHere, () => {
  const target = path.join(plantedParent('again'), 'app')
  assert.equal(install(plain, win(target)), 0)
  assert.equal(install(plain, win(target)), 0)
  assertProtected(target)
  run(REG, ['delete', REG_KEY, '/f'])
})

test('a forward-slash path and a trailing backslash are accepted and normalised', onlyHere, () => {
  const parent = plantedParent('slashes')
  const target = `${parent.replace(/\\/g, '/')}/app/`
  assert.equal(install(plain, target), 0)
  assertProtected(path.join(parent, 'app'))
  run(REG, ['delete', REG_KEY, '/f'])
})

// ---- refusals: exit code 3, nothing written --------------------------------------------------------------------------------------------

function freeLetter() {
  for (const letter of 'YXWVUTSRQ') if (!fs.existsSync(`${letter}:\\`)) return letter
  throw new Error('no free drive letter for a SUBST drive')
}

function expectRefused(target, label) {
  const before = regKeyExists()
  assert.equal(install(plain, target), CODE.refused, `${label}: expected exit code ${CODE.refused} (${lastOutput})`)
  assert.equal(regKeyExists(), before, `${label}: the registry was written`)
}

test('a drive root is refused and nothing is written to it', onlyHere, () => {
  const fake = unique('fake-root')
  fs.mkdirSync(fake, { recursive: true })
  created.push(fake)
  const letter = freeLetter()
  assert.equal(run(SUBST, [`${letter}:`, win(fake)]).status, 0)
  substs.push(letter)
  for (const form of [`${letter}:\\`, `${letter}:`, `${letter}:/`]) {
    expectRefused(form, `drive root ${form}`)
    assert.deepEqual(fs.readdirSync(fake), [], `files were written to the drive root through ${form}`)
  }
  expectRefused(`${letter}:\\nested\\..`, 'a dot segment that leads to the drive root')
  assert.deepEqual(fs.readdirSync(fake), [])
})

test('a network (UNC) path is refused', onlyHere, () => {
  const scratch = unique('unc-target')
  fs.mkdirSync(scratch, { recursive: true })
  created.push(scratch)
  const share = `\\\\localhost\\${scratch[0]}$${win(scratch).slice(2)}\\inner`
  for (const target of [share, '\\\\server\\share\\app', '//server/share/app', '\\\\?\\UNC\\server\\share\\app', '\\\\?\\D:\\dev\\tmp\\x']) {
    expectRefused(target, `UNC ${target}`)
  }
  assert.deepEqual(fs.readdirSync(scratch), [])
})

test('Program Files and Windows are refused, also through dot segments and short names', { skip: NO_MAKENSIS || (elevated() ? 'the PC is elevated: this test would not be safe' : false) }, () => {
  const probes = [
    'C:\\Program Files\\nqt-hooks-refusal-test', 'C:\\Program Files (x86)\\nqt-hooks-refusal-test', 'C:\\Windows\\nqt-hooks-refusal-test',
    'C:\\Windows', 'C:\\Program Files', 'C:\\Users\\..\\Windows\\nqt-hooks-refusal-test', 'c:/windows/nqt-hooks-refusal-test', 'C:\\PROGRA~1\\nqt-hooks-refusal-test',
  ]
  for (const target of probes) expectRefused(target, target)
  for (const never of ['C:\\Program Files\\nqt-hooks-refusal-test', 'C:\\Windows\\nqt-hooks-refusal-test']) assert.equal(fs.existsSync(never), false)
})

test('a relative path, a bare drive and a drive-relative path are refused', onlyHere, () => {
  for (const target of ['app', '.\\app', '\\app', 'D:app', 'Q']) expectRefused(target, target)
})

test('a character Windows does not allow in a folder name is refused (a wildcard would reach icacls)', onlyHere, () => {
  const parent = plantedParent('chars')
  for (const name of ['star*', 'what?', 'pipe|', 'less<', 'more>']) expectRefused(path.join(parent, name), name)
  assert.deepEqual(fs.readdirSync(parent), [])
})

test('a junction and an existing file are refused', onlyHere, () => {
  const parent = plantedParent('links')
  const real = path.join(parent, 'real')
  fs.mkdirSync(real)
  const link = path.join(parent, 'link')
  fs.symlinkSync(real, link, 'junction')
  expectRefused(link, 'junction')
  assert.deepEqual(fs.readdirSync(real), [])
  const file = path.join(parent, 'a-file')
  fs.writeFileSync(file, 'x')
  expectRefused(file, 'file')
})

// ---- the ancestors of the folder (CWE-59, CWE-732): a link or a parent another account controls is refused ------------------------------

test('a junction in a parent segment is refused and nothing is written through it', onlyHere, () => {
  const base = plantedParent('anc-junction')
  const real = path.join(base, 'real')
  fs.mkdirSync(real)
  fs.symlinkSync(real, path.join(base, 'j'), 'junction')
  expectRefused(path.join(base, 'j', 'app'), 'folder below a junction')
  expectRefused(path.join(base, 'j', 'deeper', 'app'), 'two levels below a junction')
  assert.deepEqual(fs.readdirSync(real), [])
})

test('a parent whose permissions let another principal delete its children, change its DACL or take ownership is refused', onlyHere, () => {
  for (const [rights, label] of [['F', 'full control'], ['(DC)', 'delete child'], ['(WDAC)', 'change permissions'], ['(WO)', 'take ownership']]) {
    const parent = unique(`anc-${label.replace(/ /g, '-')}`)
    fs.mkdirSync(parent, { recursive: true })
    created.push(parent)
    grant(parent, SIDS.everyone, rights)
    expectRefused(path.join(parent, 'app'), `parent grants Everyone ${label}`)
    assert.deepEqual(fs.readdirSync(parent), [], `${label}: something was written`)
  }
})

test('a grandparent that Everyone controls is refused even when the parent itself is ordinary', onlyHere, () => {
  const grandparent = unique('anc-grandparent')
  fs.mkdirSync(grandparent, { recursive: true })
  created.push(grandparent)
  grant(grandparent, SIDS.everyone, 'F', false)
  const parent = path.join(grandparent, 'middle')
  fs.mkdirSync(parent)
  assert.equal(aclOf(parent).rules.some((r) => r.sid === SIDS.everyone), false, 'the plant leaked into the parent')
  expectRefused(path.join(parent, 'app'), 'grandparent grants Everyone full control')
  assert.deepEqual(fs.readdirSync(parent), [])
})

test('a parent that grants other principals write but not delete-child, change-permissions or take-ownership is still accepted', onlyHere, () => {
  const target = path.join(plantedParent('anc-ok'), 'deep', 'er', 'app')
  assert.equal(install(plain, win(target)), 0, lastOutput)
  assertProtected(target)
  run(REG, ['delete', REG_KEY, '/f'])
})

// ---- the owner: whoever owns a folder can rewrite its DACL after the install (CWE-732) ----------------------------------------------------

test('an existing folder owned by another account is refused with code 3 before any permission is touched', onlyHere, () => {
  const target = path.join(plantedParent('foreign-owner'), 'app')
  fs.mkdirSync(target)
  grant(target, SIDS.everyone, 'F')
  const planted = path.join(target, 'planted.txt')
  fs.writeFileSync(planted, 'left by the other account')
  const before = regKeyExists()
  assert.equal(install(ownerProbe, win(target)), CODE.refused, `expected exit code ${CODE.refused} (${lastOutput})`)
  assert.equal(regKeyExists(), before)
  assert.equal(fs.existsSync(path.join(target, 'stub-app.exe')), false)
  assert.equal(fs.existsSync(planted), true, 'the refused folder was modified')
  // icacls never ran: Everyone still holds its planted full control.
  assert.equal(aclOf(target).rules.some((r) => r.sid === SIDS.everyone), true)
})

test('a folder or file that ends up owned by another account fails the read-back with code 5 and is undone', onlyHere, () => {
  const target = path.join(plantedParent('foreign-readback'), 'app')
  assert.equal(install(ownerProbe, win(target)), CODE.daclWrong, `expected exit code ${CODE.daclWrong} (${lastOutput})`)
  assert.equal(fs.existsSync(path.join(target, 'stub-app.exe')), false)
  assert.equal(fs.existsSync(path.join(target, 'uninstall.exe')), false)
  assert.equal(regKeyExists(), false)
})

test('a file pre-planted in the folder keeps the installing user as owner after a normal install', onlyHere, () => {
  const target = path.join(plantedParent('owner-ok'), 'app')
  fs.mkdirSync(target)
  fs.writeFileSync(path.join(target, 'stub-app.exe'), 'an old copy')
  assert.equal(install(plain, win(target)), 0, lastOutput)
  for (const file of ['stub-app.exe', 'WebView2Loader.dll', 'uninstall.exe']) assertTrustedOwner(path.join(target, file))
  assertTrustedOwner(target)
  run(REG, ['delete', REG_KEY, '/f'])
})

// ---- a folder whose permissions cannot be set ----------------------------------------------------------------------------------------

test('a folder whose DACL cannot be set stops the install with code 4 and writes nothing', { skip: NO_MAKENSIS || (elevated() ? 'the PC is elevated: this test would not be safe' : false) }, () => {
  const parent = 'C:\\ProgramData\\Microsoft'
  const probe = path.join(parent, `nqt-hooks-probe-${process.pid}`)
  let writable = false
  try { fs.mkdirSync(probe); writable = true; fs.rmdirSync(probe) } catch { /* the usual case: not writable */ }
  if (writable || !fs.existsSync(parent)) return // this PC lets the user write here: the case cannot be built
  const target = path.join(parent, 'nqt-hooks-no-such-folder', 'app')
  assert.equal(install(plain, target), CODE.daclFailed)
  assert.equal(fs.existsSync(path.join(parent, 'nqt-hooks-no-such-folder')), false)
  assert.equal(regKeyExists(), false)
})

// ---- the read-back --------------------------------------------------------------------------------------------------------------------

test('a folder whose DACL gains Users after the files were written fails the install with code 5 and is undone', onlyHere, () => {
  const target = path.join(plantedParent('tamper-dir'), 'app')
  assert.equal(install(folderTamper, win(target)), CODE.daclWrong)
  assert.equal(fs.existsSync(path.join(target, 'stub-app.exe')), false)
  assert.equal(fs.existsSync(path.join(target, 'uninstall.exe')), false)
  assert.equal(regKeyExists(), false)
})

test('an exe whose DACL gains Everyone after it was written fails the install with code 5 and is undone', onlyHere, () => {
  const target = path.join(plantedParent('tamper-file'), 'app')
  assert.equal(install(fileTamper, win(target)), CODE.daclWrong)
  assert.equal(fs.existsSync(path.join(target, 'stub-app.exe')), false)
  assert.equal(regKeyExists(), false)
})

// ---- the default folder: %LOCALAPPDATA%\Programs\<product> (the VS Code user setup and Chrome per-user pattern) ------------------------

/**
 * A stub whose default folder is whatever NQT_STUB_INSTDIR names (set in .onInit, as the template sets its own default), that
 * writes the folder it ends up with to a file under ROOT instead of installing, so the test never writes to the profile.
 */
function compileDefaultStub() {
  const dir = unique('stub-default')
  fs.mkdirSync(dir, { recursive: true })
  created.push(dir)
  const out = path.join(dir, 'stub-setup.exe')
  const script = path.join(dir, 'stub.nsi')
  const report = path.join(dir, 'instdir.txt')
  const lines = [
    'Unicode true', 'RequestExecutionLevel user', 'SilentInstall silent', 'ShowInstDetails nevershow',
    '!include MUI2.nsh', '!include LogicLib.nsh', ...(WITHOUT_HOOKS ? [] : [`!include "${win(HOOKS)}"`]),
    '!insertmacro MUI_LANGUAGE "English"', '!define MAINBINARYNAME "stub-app"', 'Name "stub"', `OutFile "${win(out)}"`, 'InstallDir "D:\\dev\\tmp\\dec1-hooks-tests\\fallback-never-used"',
    'Function .onInit', '  ReadEnvStr $0 NQT_STUB_INSTDIR', '  ${If} $0 != ""', '    StrCpy $INSTDIR $0', '  ${EndIf}',
    // The guard alone is under test here: the section that creates the folder is switched off, so no folder is made in the profile.
    ...(WITHOUT_HOOKS ? [] : ['  SectionSetFlags ${NqtSecPrepare} 0']), 'FunctionEnd',
    'Section Report', `  FileOpen $0 "${win(report)}" w`, '  FileWrite $0 "$INSTDIR"', '  FileClose $0', '  Quit', 'SectionEnd', 'Section Uninstall', 'SectionEnd', '',
  ]
  fs.writeFileSync(script, lines.join('\r\n'))
  const built = run(MAKENSIS, ['/V2', script], { env: { ...process.env, TEMP: ROOT, TMP: ROOT } })
  assert.equal(built.status, 0, `makensis failed:\n${built.stdout}\n${built.stderr}`)
  return { exe: out, report }
}

/** The folder a silent install without /D= ends up with when the default is "start". */
function defaultFolderFor(stub, start) {
  fs.rmSync(stub.report, { force: true })
  const result = spawnSync(stub.exe, ['/S'], { encoding: 'utf8', windowsHide: true, env: { ...process.env, TEMP: ROOT, TMP: ROOT, NQT_STUB_INSTDIR: start } })
  assert.equal(result.error, undefined, `the installer did not start: ${result.error}`)
  assert.equal(fs.existsSync(stub.report), true, `the stub wrote no report for ${start} (exit code ${result.status})`)
  return fs.readFileSync(stub.report, 'latin1')
}

const localAppData = () => process.env.LOCALAPPDATA || ''

test('the bundler default %LOCALAPPDATA%\\<product> moves under Programs, anything else stays as it is', onlyHere, () => {
  const stub = compileDefaultStub()
  const local = localAppData()
  assert.notEqual(local, '')
  const cases = [
    [path.join(local, 'product x'), path.join(local, 'Programs', 'product x')],
    [path.join(local, 'Programs', 'product x'), path.join(local, 'Programs', 'product x')],
    [path.join(local, 'Programs'), path.join(local, 'Programs')],
    [path.join(local, 'a', 'b'), path.join(local, 'a', 'b')],
    [path.join(ROOT, 'default-elsewhere', 'product x'), path.join(ROOT, 'default-elsewhere', 'product x')],
  ]
  for (const [start, want] of cases) assert.equal(defaultFolderFor(stub, start).toLowerCase(), want.toLowerCase(), `default ${start}`)
})

test('the folder page default moves too (MUI_CUSTOMFUNCTION_GUIINIT calls the same rule, and the hooks compile with MUI_LANGUAGE)', () => {
  const text = fs.readFileSync(HOOKS, 'utf8')
  assert.match(text, /!define MUI_CUSTOMFUNCTION_GUIINIT (\w+)[\s\S]*?Function \1\b[\s\S]*?Call NqtDefaultUnderPrograms[\s\S]*?FunctionEnd/)
  assert.doesNotMatch(text, /^\s*Function \.onGUIInit/m)
})

// ---- nothing else may sit in the install folder (a planted dwmapi.dll loads into the app on every launch: CWE-427) ----------------------------------
// The shipped exe imports dwmapi.dll and iphlpapi.dll by name and neither is a KnownDLL, so a DLL of that name beside the exe wins the search.

const DROPPER = `param([string]$Dir, [string]$Ready, [string]$Out)
[void](Get-Acl -LiteralPath (Split-Path $Dir))
Set-Content -LiteralPath $Ready -Value ready
$deadline = [DateTime]::UtcNow.AddSeconds(60)
while (-not [IO.Directory]::Exists($Dir)) { if ([DateTime]::UtcNow -gt $deadline) { exit 2 } }
$a = Get-Acl -LiteralPath $Dir
$seen = @{ protected = $a.AreAccessRulesProtected; rules = @($a.Access | ForEach-Object { @{ sid = $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value; inherited = $_.IsInherited } }) }
$dropError = ''
try { [IO.File]::WriteAllText((Join-Path $Dir 'dwmapi.dll'), 'planted') } catch { $dropError = $_.Exception.Message }
$seen.dropError = $dropError
$seen | ConvertTo-Json -Depth 4 -Compress | Set-Content -LiteralPath $Out
`

const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const waitFor = (file, ms) => { for (let waited = 0; waited < ms && !fs.existsSync(file); waited += 25) sleepMs(25); return fs.existsSync(file) }

/** Starts a process that waits for the install folder to appear, reads its permissions at once and drops dwmapi.dll into it. */
function startDropper(dir) {
  const base = unique('dropper')
  fs.mkdirSync(base, { recursive: true })
  created.push(base)
  const script = path.join(base, 'drop.ps1')
  const ready = path.join(base, 'ready.txt')
  const out = path.join(base, 'seen.json')
  fs.writeFileSync(script, DROPPER)
  const child = spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Dir', win(dir), '-Ready', ready, '-Out', out], { windowsHide: true, stdio: 'ignore' })
  assert.equal(waitFor(ready, 20000), true, 'the watcher did not start')
  return { child, seen: () => (waitFor(out, 10000) ? JSON.parse(fs.readFileSync(out, 'utf8').replace(/^﻿/, '')) : null) }
}

test('a DLL planted in an existing folder is refused with code 3 before anything is changed', onlyHere, () => {
  const target = path.join(plantedParent('plant-existing'), 'app')
  fs.mkdirSync(target)
  grant(target, SIDS.everyone, 'F')
  const planted = path.join(target, 'dwmapi.dll')
  fs.writeFileSync(planted, 'planted')
  const before = regKeyExists()
  assert.equal(install(plain, win(target)), CODE.refused, `expected exit code ${CODE.refused} (${lastOutput})`)
  assert.equal(regKeyExists(), before)
  assert.equal(fs.existsSync(path.join(target, 'stub-app.exe')), false, 'files were written beside the planted DLL')
  assert.equal(fs.existsSync(planted), true)
  assert.equal(aclOf(target).rules.some((r) => r.sid === SIDS.everyone), true, 'the refused folder was modified')
})

test('other planted entries are refused too: a folder, a manifest, a second DLL and a text file', onlyHere, () => {
  const entries = [['dwmapi.dll.local', 'dir'], ['stub-app.exe.manifest', 'file'], ['iphlpapi.dll', 'file'], ['notes.txt', 'file'], ['sub', 'dir']]
  for (const [name, kind] of entries) {
    const target = path.join(plantedParent('plant-kinds'), 'app')
    fs.mkdirSync(target)
    if (kind === 'dir') fs.mkdirSync(path.join(target, name))
    else fs.writeFileSync(path.join(target, name), 'planted')
    assert.equal(install(plain, win(target)), CODE.refused, `${name}: expected exit code ${CODE.refused} (${lastOutput})`)
    assert.equal(fs.existsSync(path.join(target, 'stub-app.exe')), false, `${name}: files were written`)
  }
})

test('a folder holding only the product files of an earlier install is accepted', onlyHere, () => {
  const target = path.join(plantedParent('earlier'), 'app')
  assert.equal(install(plain, win(target)), 0, lastOutput)
  assert.equal(install(plain, win(target)), 0, lastOutput)
  assert.deepEqual(fs.readdirSync(target).sort(), ['WebView2Loader.dll', 'stub-app.exe', 'uninstall.exe'])
  run(REG, ['delete', REG_KEY, '/f'])
})

test('a new folder is created with its final permissions: no moment where it inherits what the parent grants', onlyHere, () => {
  const target = path.join(plantedParent('atomic'), 'app')
  const watcher = startDropper(target)
  install(plain, win(target))
  const seen = watcher.seen()
  watcher.child.kill()
  run(REG, ['delete', REG_KEY, '/f'])
  assert.notEqual(seen, null, 'the watcher never saw the folder')
  const rules = [].concat(seen.rules)
  assert.equal(seen.protected, true, `the folder first appeared inheriting from its parent: ${JSON.stringify(rules)}`)
  assert.equal(rules.some((r) => r.inherited), false, `the folder first appeared with inherited rules: ${JSON.stringify(rules)}`)
  assert.deepEqual(broad(rules), [])
})

test('a DLL dropped into the new folder while the install runs fails the read-back with code 5 and the product files are undone', onlyHere, () => {
  const target = path.join(plantedParent('plant-new'), 'app')
  const watcher = startDropper(target)
  const code = install(plain, win(target))
  const seen = watcher.seen()
  watcher.child.kill()
  assert.notEqual(seen, null, 'the watcher never saw the folder')
  assert.equal(seen.dropError, '', `the watcher could not drop the file: ${seen.dropError}`)
  assert.equal(code, CODE.daclWrong, `expected exit code ${CODE.daclWrong} (${lastOutput})`)
  assert.equal(fs.existsSync(path.join(target, 'stub-app.exe')), false)
  assert.equal(fs.existsSync(path.join(target, 'uninstall.exe')), false)
  assert.equal(regKeyExists(), false)
})

// ---- the hooks file itself -------------------------------------------------------------------------------------------------------------

test('the hooks file is pure ASCII with no byte order mark (the unicode NSIS build reads it as the ANSI code page otherwise)', () => {
  const bytes = fs.readFileSync(HOOKS)
  assert.equal(bytes.every((b) => b < 0x80), true)
  assert.notEqual(bytes.slice(0, 3).toString('hex'), 'efbbbf')
})

test('the hooks file holds no em or en dash', () => {
  const text = fs.readFileSync(HOOKS, 'utf8')
  assert.doesNotMatch(text, /[\u2013\u2014]/)
})
