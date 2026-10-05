// The artefact check (04 D5.4, 03 section 6 item 8, 05 G07): what a release folder from build-release.ps1 must and must
// not contain. Node built-ins only; the PE reading is pe-info.mjs.
//
//   node desktop/scripts/artefact-check.mjs <release folder> [--json]   the full check, exit 1 on any problem
//   node desktop/scripts/artefact-check.mjs --tree <folder>             the lab-data path rules over an installed folder
//   node desktop/scripts/artefact-check.mjs --paths <file>...           the build-machine path scan over built binaries (exit 2: no file)
//
// The full check fails on:
//   - any .parquet file, any path under data/, results/, live/ or backtests/output/, and any file named like a sealed
//     result, over every file of the folder and over every destination the installer script installs;
//   - an exe (payload\<build>\nq-lab-terminal.exe) whose RT_MANIFEST lacks Common-Controls 6.0, PerMonitorV2 or
//     asInvoker (or that has more than one manifest), or that imports a DLL which is neither a system DLL nor the
//     pinned WebView2Loader.dll next to it (libgcc_s_seh-1, libwinpthread-1 and libstdc++-6 in particular);
//   - an installer (*_x64-setup.exe) that does not request asInvoker, or an installer script that is not
//     currentUser, does not embed the bootstrapper (release) or has no /NS (no shortcuts) switch;
//   - a configuration (config\tauri.conf.json, merged with the build's identity file) with createUpdaterArtifacts
//     other than false or with plugins.updater, a build that is not per-user NSIS with the embedded bootstrapper, an
//     exe that does not carry the configuration's identifier, or an exe that holds the updater plugin;
//   - installer hooks (bundle.windows.nsis.installerHooks, windows/nsis/hooks.nsh) that are not set, not included by the
//     installer script, or not protective: no NSIS_HOOK_PREINSTALL that protects the install folder or NSIS_HOOK_POSTINSTALL
//     that reads it back, icacls not started by its full path under the system folder with its exit code read, no
//     inheritance removal, a grant to anyone but the user, SYSTEM and Administrators, a missing refusal of a drive root,
//     a network path, Program Files or Windows, or a recursive folder removal (CWE-427, CWE-732; 03 section 13.1). The
//     compiled installer is compressed, so the hooks are proved by the generated script's include of the hooks file
//     (read from nsis/<build>/ beside the script, else from the include path) and by the configuration that asked for it;
//   - a drive-letter path under D:\dev or C:\Users inside a built binary (payload\<build>\*.exe and *.dll, the *_x64-setup.exe
//     installers), in either slash direction, doubled backslashes or not, as 8-bit or UTF-16 text: build-release.ps1 remaps
//     the cargo home, the rustup home and the source folder to neutral prefixes (rustc --remap-path-prefix), and this scan
//     fails the folder if one still shows (the 0.1.2 and 0.2.0 exes held D:\dev\cargo\registry Rust panic locations);
//   - a PROVENANCE.json without a webview2_bootstrapper entry (sha256, validly signed by Microsoft Corporation) for the
//     bootstrapper the installers embed and run silently, or whose path is not the one an installer script embeds.
// Tauri 2 compiles its configuration into the exe as Rust data, not JSON, so the configuration is read from the files
// the build used (build-release.ps1 copies them to config\) and tied to the exe by its identifier.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { info, problems as peProblems, LOADER } from './pe-info.mjs'

/** The Microsoft-signed WebView2Loader.dll the GNU host links dynamically (W0A P5; the same pin as check.ps1). */
export const PINNED_LOADER_SHA256 = '86545b66cdb0603bc26b626fb9ad610cb6e71f28d468f5ea66df23b03dda96d5'
const BANNED_DIRS = new Set(['data', 'results', 'live'])
const SEALED_NAME = /sealed|^oos_access_log|^oos_openings|^(ledger|registry)\.csv$/i
const UPDATER_TOKENS = ['tauri-plugin-updater', 'tauri_plugin_updater', 'plugin:updater']
// Strings that only a smoke build compiles in (its switches, its debugging port file and its test variables); the
// release and measure builds must hold none of them (04 D5.4: the release has no smoke feature).
const SMOKE_ONLY_STRINGS = ['--attach-url', 'DevToolsActivePort', 'NQT_SMOKE_FORCE_PANIC', 'NQT_TEST_POLICY_ROOT']
const MAIN_EXE = 'nq-lab-terminal.exe'
const MICROSOFT_SIGNER = /(^|,\s*)O=Microsoft Corporation(,|$)/
// installtest is the release feature set under another product name and identifier, so install-test.ps1 can install and upgrade it beside a real install.
const BUILDS = ['release', 'measure', 'smoke', 'installtest']
const SUFFIXED_BUILDS = ['smoke', 'measure', 'installtest']
const IDENTITY_FILE = { release: 'tauri.conf.json', measure: 'tauri.measure.conf.json', smoke: 'tauri.smoke.conf.json', installtest: 'tauri.installtest.conf.json' }

const segmentsOf = (p) => String(p).replace(/\\/g, '/').split('/').filter((s) => s !== '' && s !== '.')

// ---- paths -----------------------------------------------------------------------------------------------------------------

/** What is wrong with one file name (the last segment of a path). */
function nameProblems(name, where) {
  const out = []
  if (/\.parquet$/i.test(name)) out.push(`${where}: a .parquet file`)
  if (SEALED_NAME.test(name)) out.push(`${where}: a file named like a sealed or lab result`)
  return out
}

/** The lab-data rules over relative paths (forward or back slashes). */
export function pathProblems(paths) {
  const out = []
  for (const p of paths) {
    const segs = segmentsOf(p)
    if (segs.length === 0) continue
    const lower = segs.map((s) => s.toLowerCase())
    out.push(...nameProblems(segs[segs.length - 1], p))
    if (segs.slice(0, -1).some((s) => /sealed/i.test(s))) out.push(`${p}: a path inside a folder named like a sealed result`)
    const dirs = lower.slice(0, -1)
    const banned = dirs.find((s) => BANNED_DIRS.has(s)) ?? (lower.length > 1 && BANNED_DIRS.has(lower[lower.length - 1]) ? lower[lower.length - 1] : null)
    if (banned) out.push(`${p}: a path under ${banned}/ (lab data never ships)`)
    const at = lower.indexOf('backtests')
    if (at >= 0 && lower[at + 1] === 'output') out.push(`${p}: a path under backtests/output/`)
  }
  return out
}

/** Every file under `dir` as a forward-slash path relative to it. */
export function listFiles(dir) {
  const out = []
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(path.relative(dir, full).split(path.sep).join('/'))
    }
  }
  walk(dir)
  return out.sort()
}

// ---- the installer script --------------------------------------------------------------------------------------------------

function defines(text) {
  const map = new Map()
  for (const m of text.matchAll(/^\s*!define\s+(?:\/\w+\s+)?(\w+)\s+"([^"]*)"/gm)) map.set(m[1], m[2])
  return map
}

const expand = (value, map) => value.replace(/\$\{(\w+)\}/g, (all, name) => map.get(name) ?? all)

/** Every `File` of the script as { source, destination } (the destination relative to the install folder). */
export function installerFiles(text) {
  const map = defines(text)
  const files = []
  const problems = []
  let outPath = '$INSTDIR'
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const set = /^SetOutPath\s+(.+)$/.exec(line)
    if (set) { outPath = set[1].replace(/^"|"$/g, ''); continue }
    if (!/^File\s/.test(line)) continue
    if (/^File\s+\/\w*r/i.test(line)) problems.push(`installer script: a recursive File cannot be checked (${line})`)
    const quoted = [...line.matchAll(/"([^"]*)"/g)].map((m) => expand(m[1], map))
    const oname = quoted.find((q) => q.startsWith('/oname='))
    const source = quoted.filter((q) => !q.startsWith('/oname=')).pop() ?? ''
    const destination = oname ? oname.slice('/oname='.length) : `${outPath}\\${segmentsOf(source).pop() ?? ''}`
    files.push({ source, destination })
  }
  return { files, problems }
}

// ---- the installer hooks ---------------------------------------------------------------------------------------------------

const HOOK_MACROS = { NSIS_HOOK_PREINSTALL: 'NqtProtectInstallDir', NSIS_HOOK_POSTINSTALL: 'NqtVerifyInstallDir' }
const REFUSAL_TOKENS = ['GetFullPathNameW', 'GetDriveTypeW', 'GetFileAttributesW', '$WINDIR', '$PROGRAMFILES32', '$PROGRAMFILES64']
const BROAD_PRINCIPAL = /S-1-1-0|S-1-5-11|S-1-5-32-545|Everyone|Users|Authenticated/i
const SHELL_CALL = /\bExecWait\b|\bExecShell(Wait)?\b|\bExec\s|\bcmd(\.exe)?\s+\/c\b|powershell/i
const hookCode = (text) => text.split(/\r?\n/).filter((line) => !/^\s*;/.test(line))

/** What is wrong with the installer hooks file (windows/nsis/hooks.nsh): the rules in the header of this file. */
export function hooksProblems(text, name) {
  const out = []
  const add = (message) => out.push(`${name}: installer hooks: ${message}`)
  const code = hookCode(text)
  const joined = code.join('\n')
  for (const [macro, call] of Object.entries(HOOK_MACROS)) {
    const body = new RegExp(String.raw`^\s*!macro\s+${macro}\b([\s\S]*?)^\s*!macroend`, 'm').exec(joined)
    if (!body) add(`no ${macro} macro`)
    else if (!new RegExp(String.raw`Call\s+${call}\b`).test(body[1])) add(`${macro} does not call ${call}`)
  }
  if (!/\$SYSDIR\\icacls\.exe/.test(joined)) add('icacls is not started by its full path ($SYSDIR\\icacls.exe)')
  if (code.some((line) => /(^|['"])icacls\b/.test(line))) add('icacls is started through the search path, not by its full path')
  if (code.some((line) => SHELL_CALL.test(line))) add('a shell, ExecWait, ExecShell or cmd call (a command line must be started by nsExec::ExecToStack with its full path)')
  if (!/nsExec::ExecToStack/.test(joined)) add('no nsExec::ExecToStack call, so the icacls exit code is never read')
  if (!/\/inheritance:r\b/.test(joined)) add('no /inheritance:r: the folder would keep what its parent grants')
  const grants = code.filter((line) => /\/grant(:r)?\b/i.test(line))
  for (const sid of ['S-1-5-18', 'S-1-5-32-544']) {
    if (!grants.some((line) => line.includes(sid))) add(`no grant to ${sid} (SYSTEM or Administrators)`)
  }
  for (const line of grants) {
    if (BROAD_PRINCIPAL.test(line)) add(`a grant to a broad principal (Everyone, Users or Authenticated Users): ${line.trim()}`)
  }
  for (const token of REFUSAL_TOKENS) {
    if (!joined.includes(token)) add(`no refusal rule using ${token} (a drive root, a network path, Program Files, Windows, a link)`)
  }
  // MUI2 owns .onGUIInit; a second one stops makensis, so the rule hangs on MUI_CUSTOMFUNCTION_GUIINIT instead.
  const guiInit = /^\s*!define\s+MUI_CUSTOMFUNCTION_GUIINIT\s+(\w+)/m.exec(joined)
  const guiBody = guiInit ? new RegExp(String.raw`^\s*Function\s+${guiInit[1]}\b([\s\S]*?)^\s*FunctionEnd`, 'm').exec(joined) : null
  if (!guiBody || !/Call\s+NqtDefaultUnderPrograms\b/.test(guiBody[1])) add('the default folder is not moved under %LOCALAPPDATA%\\Programs on the folder page (MUI_CUSTOMFUNCTION_GUIINIT does not lead to NqtDefaultUnderPrograms)')
  if (/^\s*Function\s+\.onGUIInit\b/m.test(joined)) add('a second .onGUIInit: MUI2 defines it and makensis stops (use MUI_CUSTOMFUNCTION_GUIINIT)')
  const guard = /^\s*Section\s+"-NqtTargetGuard"([\s\S]*?)^\s*SectionEnd/m.exec(joined)
  if (!guard || !/Call\s+NqtDefaultUnderPrograms\b/.test(guard[1])) add('the default folder is not moved under %LOCALAPPDATA%\\Programs in a silent install (the guard section does not call NqtDefaultUnderPrograms)')
  if (!joined.includes('$LOCALAPPDATA\\Programs\\')) add('the default folder is not %LOCALAPPDATA%\\Programs\\<product>')
  if (/\bRMDir\s+\/r\b/i.test(joined)) add('RMDir /r: the uninstaller must remove only what the installer wrote')
  return out
}

const includeOf = (scriptText, hooksName) => {
  const wanted = hooksName.toLowerCase()
  for (const m of scriptText.matchAll(/^\s*!include\s+"([^"]+)"/gm)) {
    if (segmentsOf(m[1]).pop()?.toLowerCase() === wanted) return m[1]
  }
  return null
}

/** The installer script includes the hooks file the configuration names, and that file passes the hook rules. */
export function installerHooksProblems({ scriptText, config, dir, build }) {
  const configured = config?.bundle?.windows?.nsis?.installerHooks
  if (typeof configured !== 'string' || configured === '') return [] // configProblems reports it
  const hooksName = segmentsOf(configured).pop() ?? ''
  const include = includeOf(scriptText, hooksName)
  if (!include) return [`${build}: the installer script does not include the installer hooks (${hooksName}), so the install folder is not protected`]
  const beside = path.join(dir, 'nsis', build, hooksName)
  const file = fs.existsSync(beside) ? beside : fs.existsSync(include) ? include : null
  if (!file) return [`${build}: the installer hooks file ${hooksName} is neither in nsis/${build}/ nor at the include path ${include}, so it cannot be checked`]
  return hooksProblems(fs.readFileSync(file, 'utf8'), build)
}


export function installerScriptProblems(text, name) {
  const out = []
  const map = defines(text)
  if (map.get('INSTALLMODE') !== 'currentUser') out.push(`${name}: INSTALLMODE is ${map.get('INSTALLMODE')}, not currentUser (a per-user install, no admin)`)
  if ((name === 'release' || name === 'installtest') && map.get('INSTALLWEBVIEW2MODE') !== 'embedBootstrapper') out.push(`${name}: INSTALLWEBVIEW2MODE is ${map.get('INSTALLWEBVIEW2MODE')}, not embedBootstrapper`)
  if (!/^\s*!insertmacro\s+MUI_PAGE_DIRECTORY\b/m.test(text)) out.push(`${name}: the installer script has no folder page (MUI_PAGE_DIRECTORY), so the install folder could not be chosen`)
  if (!/GetOptions\}?\s+\$CMDLINE\s+"\/NS"/.test(text)) out.push(`${name}: the installer script has no /NS (no shortcuts) switch`)
  const { files, problems } = installerFiles(text)
  out.push(...problems.map((p) => `${name}: ${p}`))
  for (const f of files) {
    out.push(...pathProblems([f.destination]).map((p) => `${name} installs ${p}`))
    out.push(...nameProblems(segmentsOf(f.source).pop() ?? '', `${name} installs the source ${f.source}`))
  }
  return out
}

// ---- executables -----------------------------------------------------------------------------------------------------------

const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

/** Manifest and import problems of an exe, with the pinned loader beside it. */
export function exeProblems(file, { loaderFile = null, loaderSha256 = PINNED_LOADER_SHA256, allowLoader = false } = {}) {
  const pe = info(file)
  const out = peProblems(pe, { allowLoader: true })
  const importsLoader = pe.imports.some((i) => i.dll.toLowerCase() === LOADER)
  if (!importsLoader || allowLoader) return out
  if (!loaderFile || !fs.existsSync(loaderFile)) out.push('imports WebView2Loader.dll but no WebView2Loader.dll lies beside the exe')
  else if (sha256File(loaderFile) !== loaderSha256.toLowerCase()) out.push(`the WebView2Loader.dll beside the exe is not the pinned one (${sha256File(loaderFile)})`)
  return out
}

/** An installer must request asInvoker (no admin prompt, no elevation). */
export function installerProblems(file) {
  const pe = info(file)
  if (pe.manifests.length === 0) return ['the installer has no RT_MANIFEST, so it does not request asInvoker']
  return pe.manifests.filter((m) => m.entries.executionLevel !== 'asInvoker').map((m) => `the installer manifest requests ${m.entries.executionLevel}, not asInvoker`)
}

// ---- configuration ---------------------------------------------------------------------------------------------------------

/** JSON merge patch (RFC 7386), as Tauri merges an identity file over tauri.conf.json. */
export function mergePatch(target, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch
  const out = target !== null && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key]
    else out[key] = mergePatch(out[key], value)
  }
  return out
}

/** The exe is of the build it is filed under: no other build's identifier, and no smoke code in release or measure. */
function identityProblems(exe, identifier, name) {
  const out = []
  const base = String(identifier ?? '').replace(/.(smoke|measure|installtest)$/, '')
  for (const other of SUFFIXED_BUILDS.filter((suffix) => !String(identifier).endsWith(`.${suffix}`))) {
    if (base && exe.includes(Buffer.from(`${base}.${other}`))) out.push(`${name}: the exe carries the identifier of the ${other} build (${base}.${other})`)
  }
  if (name !== 'smoke') {
    for (const token of SMOKE_ONLY_STRINGS) if (exe.includes(Buffer.from(token))) out.push(`${name}: the exe holds smoke-build code (${token})`)
  }
  return out
}

/** The updater, per-user and bootstrapper rules over one build's effective configuration and its exe bytes. */
export function configProblems({ exe, config, name }) {
  if (!config) return [`${name}: no configuration file for this build in config/ (nothing proves the updater is off)`]
  const out = []
  const bundle = config.bundle ?? {}
  if (bundle.createUpdaterArtifacts !== false) out.push(`${name}: bundle.createUpdaterArtifacts is ${JSON.stringify(bundle.createUpdaterArtifacts)}, not false`)
  if (config.plugins && 'updater' in config.plugins) out.push(`${name}: the configuration has plugins.updater`)
  const windows = bundle.windows ?? {}
  if (windows.nsis?.installMode !== 'currentUser') out.push(`${name}: bundle.windows.nsis.installMode is ${windows.nsis?.installMode}, not currentUser`)
  if (windows.webviewInstallMode?.type !== 'embedBootstrapper') out.push(`${name}: bundle.windows.webviewInstallMode is ${JSON.stringify(windows.webviewInstallMode)}, not embedBootstrapper`)
  const hooks = windows.nsis?.installerHooks
  if (typeof hooks !== 'string' || !/\.nsh$/i.test(hooks)) out.push(`${name}: bundle.windows.nsis.installerHooks is ${JSON.stringify(hooks)}, not an installer hooks file (it protects the install folder)`)
  if (!config.identifier || !exe.includes(Buffer.from(config.identifier))) out.push(`${name}: the exe does not carry the configuration's identifier ${config.identifier}`)
  for (const token of UPDATER_TOKENS) if (exe.includes(Buffer.from(token))) out.push(`${name}: the exe holds the updater plugin (${token})`)
  out.push(...identityProblems(exe, config.identifier, name))
  return out
}

const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)

function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(stripBom(fs.readFileSync(file, 'utf8'))) : null
}

function effectiveConfig(dir, build) {
  const base = readJson(path.join(dir, 'config', 'tauri.conf.json'))
  if (!base || build === 'release') return base
  return mergePatch(base, readJson(path.join(dir, 'config', IDENTITY_FILE[build])) ?? {})
}

// ---- the embedded WebView2 bootstrapper ----------------------------------------------------------------------------------

/** The bundler downloads the bootstrapper without any check and caches it in a user-writable folder, so the build records it. */
export function bootstrapperEntryProblems(entry) {
  if (!entry || typeof entry !== 'object') return ['PROVENANCE.json has no webview2_bootstrapper entry (the embedded bootstrapper was never verified)']
  const out = []
  if (!/^[0-9a-f]{64}$/i.test(String(entry.sha256 ?? ''))) out.push('PROVENANCE.json webview2_bootstrapper has no sha256')
  if (entry.signature_status !== 'Valid') out.push(`PROVENANCE.json webview2_bootstrapper signature is ${entry.signature_status}, not Valid`)
  if (!MICROSOFT_SIGNER.test(String(entry.signer ?? ''))) out.push(`PROVENANCE.json webview2_bootstrapper is not signed by Microsoft Corporation (${entry.signer})`)
  if (!entry.path) out.push('PROVENANCE.json webview2_bootstrapper has no path')
  return out
}

/** The bootstrapper of an installer script is the one the provenance recorded. */
export function bootstrapperEmbedProblems(text, entry, name) {
  const embedded = defines(text).get('WEBVIEW2BOOTSTRAPPERPATH')
  if (!embedded || !entry?.path) return []
  if (embedded.toLowerCase() === String(entry.path).toLowerCase()) return []
  return [`${name}: the installer script embeds ${embedded}, not the recorded bootstrapper ${entry.path}`]
}

function provenanceBootstrapper(dir, problems) {
  const provenance = readJson(path.join(dir, 'PROVENANCE.json'))
  if (!provenance) { problems.push('PROVENANCE.json is missing (the embedded bootstrapper was never recorded)'); return null }
  const entry = provenance.webview2_bootstrapper
  problems.push(...bootstrapperEntryProblems(entry))
  return entry ?? null
}

// ---- build-machine paths ---------------------------------------------------------------------------------------------------

// The build machine's folders must not reach a shipped binary. Rust panic locations carry the path of the source file, so
// an unremapped build holds D:\dev\cargo\registry\... (and, for crates built from the tree, the user's profile folder).
const MACHINE_PATH_RULES = [
  ['build-machine-path-dev', /[Dd]:[\\/]+dev(?![A-Za-z0-9_])[^\x00-\x20"'<>|*?\x7f-\uffff]{0,100}/g],
  ['build-machine-path-users', /[Cc]:[\\/]+[Uu]sers(?![A-Za-z0-9_])[^\x00-\x20"'<>|*?\x7f-\uffff]{0,100}/g],
]

/** The build-machine paths in some bytes, as { rule, text, count } once per distinct path: 8-bit text and UTF-16 at both alignments. */
export function machinePathFindings(bytes) {
  const views = [bytes.toString('latin1'), bytes.toString('utf16le'), bytes.subarray(1).toString('utf16le')]
  const seen = new Map()
  for (const view of views) {
    for (const [rule, pattern] of MACHINE_PATH_RULES) {
      for (const match of view.matchAll(pattern)) {
        const key = `${rule}\n${match[0]}`
        const entry = seen.get(key) ?? { rule, text: match[0], count: 0 }
        entry.count += 1
        seen.set(key, entry)
      }
    }
  }
  return [...seen.values()]
}

/** One problem per distinct build-machine path of a file. `name` is how the report names the file. */
export function machinePathProblems(file, name = file) {
  return machinePathFindings(fs.readFileSync(file)).map((f) => `${name}: build-machine path ${f.text} (${f.rule}, ${f.count}x): remap it with rustc --remap-path-prefix`)
}

// ---- the whole folder ------------------------------------------------------------------------------------------------------

function checkBuild(dir, build, options, problems) {
  const exe = path.join(dir, 'payload', build, MAIN_EXE)
  if (!fs.existsSync(exe)) {
    if (build === 'release') problems.push(`payload/release/${MAIN_EXE} is missing`)
    return false
  }
  const loaderFile = path.join(path.dirname(exe), 'WebView2Loader.dll')
  const tag = `payload/${build}`
  problems.push(...exeProblems(exe, { loaderFile, loaderSha256: options.loaderSha256 }).map((p) => `${tag}: ${p}`))
  problems.push(...configProblems({ exe: fs.readFileSync(exe), config: effectiveConfig(dir, build), name: build }))
  const script = path.join(dir, 'nsis', build, 'installer.nsi')
  if (fs.existsSync(script)) {
    const scriptText = fs.readFileSync(script, 'utf8')
    problems.push(...installerScriptProblems(scriptText, build))
    problems.push(...installerHooksProblems({ scriptText, config: effectiveConfig(dir, build), dir, build }))
  }
  else if (build !== 'smoke') problems.push(`nsis/${build}/installer.nsi is missing`)
  return true
}

export function checkRelease(dir, options = {}) {
  const opts = { loaderSha256: options.loaderSha256 ?? PINNED_LOADER_SHA256 }
  const problems = []
  const notes = []
  const files = listFiles(dir)
  problems.push(...pathProblems(files))
  const installers = files.filter((f) => !f.includes('/') && /_x64-setup\.exe$/i.test(f))
  if (installers.length === 0) problems.push('no *_x64-setup.exe installer in the folder')
  for (const installer of installers) problems.push(...installerProblems(path.join(dir, installer)).map((p) => `${installer}: ${p}`))
  const checked = BUILDS.filter((build) => checkBuild(dir, build, opts, problems))
  const binaries = files.filter((f) => /^payload\/[^/]+\/[^/]+\.(exe|dll)$/i.test(f) || installers.includes(f))
  for (const binary of binaries) problems.push(...machinePathProblems(path.join(dir, binary), binary))
  const entry = provenanceBootstrapper(dir, problems)
  for (const build of ['release', 'measure', 'installtest']) {
    const script = path.join(dir, 'nsis', build, 'installer.nsi')
    if (fs.existsSync(script)) problems.push(...bootstrapperEmbedProblems(fs.readFileSync(script, 'utf8'), entry, build))
  }
  notes.push(`${files.length} files, ${installers.length} installers, builds checked: ${checked.join(', ')}`)
  return { problems, notes }
}

function pathsMain(files) {
  if (files.length === 0 || files.some((f) => !fs.existsSync(f) || !fs.statSync(f).isFile())) {
    console.error('usage: node artefact-check.mjs --paths <built binary>... (every file must exist)')
    return 2
  }
  const problems = files.flatMap((f) => machinePathProblems(f, f))
  if (problems.length > 0) {
    console.error('build-machine path scan FAILED:\n  ' + problems.join('\n  '))
    return 1
  }
  console.log(`build-machine path scan passed: no D:\\dev or C:\\Users path in ${files.length} file(s)`)
  return 0
}

function main(argv) {
  const pathsAt = argv.indexOf('--paths')
  if (pathsAt >= 0) return pathsMain(argv.slice(pathsAt + 1))
  const json = argv.includes('--json')
  const treeAt = argv.indexOf('--tree')
  const target = treeAt >= 0 ? argv[treeAt + 1] : argv.find((a) => !a.startsWith('--'))
  if (!target || !fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    console.error('usage: node artefact-check.mjs <release folder> [--json] | --tree <installed folder>')
    return 2
  }
  const result = treeAt >= 0 ? { problems: pathProblems(listFiles(target)), notes: [`${listFiles(target).length} files under ${target}`] } : checkRelease(target)
  if (json) console.log(JSON.stringify(result, null, 1))
  else for (const n of result.notes) console.log(n)
  if (result.problems.length > 0) {
    console.error('artefact check FAILED:\n  ' + result.problems.join('\n  '))
    return 1
  }
  console.log('artefact check passed: no lab data, manifests and imports in order, installers per-user asInvoker, updater absent')
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
