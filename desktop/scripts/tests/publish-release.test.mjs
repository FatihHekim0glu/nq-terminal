// Tests for desktop/scripts/publish-release.ps1 (REL-02): the GitHub release draft, its asset names, its SHA256SUMS, what
// is never uploaded, and the hash check after the upload. The real gh is never called: -DryRun calls nothing, and the
// other runs use a stand-in gh (a node script behind a .cmd) that keeps its "remote" in a folder under D:/dev/tmp.
//
//   node --test desktop/scripts/tests/publish-release.test.mjs
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test, { after } from 'node:test'

const SCRIPT = fileURLToPath(new URL('../publish-release.ps1', import.meta.url))
const SCRATCH = process.env.NQT_TEST_TMP || 'D:/dev/tmp/publish-release-tests'
const VERSION = '9.9.9'
const TAG = `desktop-v${VERSION}`
const SPACED = `nq-lab terminal_${VERSION}_x64-setup.exe`
const ASSET = `nq-lab.terminal_${VERSION}_x64-setup.exe`
const HOST = 'TESTPC-7731'
const created = []

const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')

// The stand-in gh: logs its arguments, keeps uploads in FAKE_GH_REMOTE and serves them back.
const FAKE_GH = `
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
const args = process.argv.slice(2)
const { FAKE_GH_LOG, FAKE_GH_REMOTE, FAKE_GH_MODE = '' } = process.env
fs.appendFileSync(FAKE_GH_LOG, JSON.stringify(args) + '\\n')
const value = (flag) => args[args.indexOf(flag) + 1]
const values = (flag) => args.flatMap((a, i) => (a === flag ? [args[i + 1]] : []))
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
if (FAKE_GH_MODE === 'create-fails' && args[1] === 'create') { console.error('HTTP 422'); process.exit(1) }
if (args[0] === 'release' && args[1] === 'create') {
  fs.mkdirSync(FAKE_GH_REMOTE, { recursive: true })
  for (const file of args.slice(3).filter((a) => !a.startsWith('--') && fs.existsSync(a) && fs.statSync(a).isFile() && !a.endsWith('.md'))) {
    fs.copyFileSync(file, path.join(FAKE_GH_REMOTE, path.basename(file)))
  }
  console.log('https://github.com/example/example/releases/tag/' + args[2])
} else if (args[0] === 'release' && args[1] === 'download') {
  const dir = value('--dir')
  fs.mkdirSync(dir, { recursive: true })
  for (const name of values('--pattern')) {
    const body = fs.readFileSync(path.join(FAKE_GH_REMOTE, name))
    fs.writeFileSync(path.join(dir, name), FAKE_GH_MODE === 'corrupt' && name.endsWith('.exe') ? Buffer.concat([body, Buffer.from('x')]) : body)
  }
} else if (args[0] === 'release' && args[1] === 'view') {
  const assets = fs.readdirSync(FAKE_GH_REMOTE).map((name) => ({ name, digest: FAKE_GH_MODE === 'bad-digest' && name.endsWith('.exe') ? 'sha256:' + '0'.repeat(64) : 'sha256:' + sha(fs.readFileSync(path.join(FAKE_GH_REMOTE, name))) }))
  console.log(JSON.stringify({ assets }))
} else { console.error('unexpected gh call'); process.exit(2) }
`

function makeWorld(name) {
  const root = path.join(SCRATCH, `${name}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`)
  created.push(root)
  const release = path.join(root, 'release')
  fs.mkdirSync(release, { recursive: true })
  const installer = Buffer.from(`MZ installer of ${name} ${crypto.randomBytes(8).toString('hex')}`)
  fs.writeFileSync(path.join(release, SPACED), installer)
  fs.writeFileSync(path.join(release, `nq-lab terminal measure_${VERSION}_x64-setup.exe`), 'MZ measure')
  fs.writeFileSync(path.join(release, `nq-lab terminal installtest_${VERSION}_x64-setup.exe`), 'MZ installtest')
  fs.writeFileSync(path.join(release, 'PROVENANCE.json'), JSON.stringify({ version: VERSION, pc: HOST }))
  fs.writeFileSync(path.join(release, 'SHA256SUMS'), `${sha(installer)} *${SPACED}\n${sha('x')} *PROVENANCE.json\n`)
  const notes = path.join(root, 'notes.md')
  fs.writeFileSync(notes, '# nq-lab terminal desktop 9.9.9 for Windows\n\nA test release.\n')
  const bin = path.join(root, 'bin')
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'fake-gh.mjs'), FAKE_GH)
  fs.writeFileSync(path.join(bin, 'gh.cmd'), `@echo off\r\nnode "%~dp0fake-gh.mjs" %*\r\n`)
  return {
    root, release, notes, installer,
    gh: path.join(bin, 'gh.cmd'),
    log: path.join(root, 'gh.log'),
    remote: path.join(root, 'remote'),
    work: path.join(root, 'work'),
  }
}

after(() => { for (const dir of created) fs.rmSync(dir, { recursive: true, force: true }) })

function run(world, extra = [], env = {}) {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Tag', TAG, '-NotesFile', world.notes, '-ReleaseDir', world.release,
    '-Gh', world.gh, '-HostName', HOST, '-WorkRoot', world.work, ...extra]
  const out = spawnSync('powershell', args, {
    encoding: 'utf8', windowsHide: true,
    env: { ...process.env, FAKE_GH_LOG: world.log, FAKE_GH_REMOTE: world.remote, ...env },
  })
  return { status: out.status, text: out.stdout + out.stderr }
}

const ghCalls = (world) => (fs.existsSync(world.log) ? fs.readFileSync(world.log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [])

test('a dry run prints the dotted asset name, the SHA256SUMS line and the gh commands, and calls and writes nothing', () => {
  const world = makeWorld('dry')
  const result = run(world, ['-DryRun'])
  assert.equal(result.status, 0, result.text)
  assert.ok(result.text.includes(`asset      ${ASSET}`), result.text)
  assert.ok(result.text.includes(`${sha(world.installer)} *${ASSET}`), result.text)
  const commands = result.text.split(/\r?\n/).filter((l) => l.startsWith('gh '))
  assert.ok(commands.length >= 2, result.text)
  assert.ok(commands[0].startsWith(`gh release create ${TAG}`) && commands[0].includes('--draft'), commands[0])
  for (const line of commands) {
    assert.ok(!/PROVENANCE|measure|installtest/i.test(line), line)
    assert.ok(!line.toUpperCase().includes(HOST), line)
  }
  assert.ok(!result.text.toUpperCase().includes(HOST), 'the PC name appears nowhere in the output')
  assert.deepEqual(ghCalls(world), [], 'gh was not called')
  assert.ok(!fs.existsSync(world.work), 'nothing was staged')
})

test('a run uploads one draft holding the installer under its dotted name and a generated SHA256SUMS, and nothing else', () => {
  const world = makeWorld('run')
  const result = run(world)
  assert.equal(result.status, 0, result.text)
  assert.match(result.text, /DRAFT desktop-v9\.9\.9 made; downloaded .* again/)
  assert.deepEqual(fs.readdirSync(world.remote).sort(), [ASSET, 'SHA256SUMS'].sort())
  assert.equal(fs.readFileSync(path.join(world.remote, 'SHA256SUMS'), 'utf8'), `${sha(world.installer)} *${ASSET}\n`)
  assert.deepEqual(fs.readFileSync(path.join(world.remote, ASSET)), world.installer)
  const [create] = ghCalls(world)
  assert.deepEqual(create.slice(0, 3), ['release', 'create', TAG])
  assert.ok(create.includes('--draft'))
  assert.ok(!create.some((a) => /PROVENANCE|measure|installtest/i.test(a)), JSON.stringify(create))
  assert.equal(create[create.indexOf('--title') + 1], `nq-lab terminal desktop ${VERSION} for Windows`)
  assert.ok(create[create.indexOf('--notes-file') + 1].endsWith('notes.md'))
  assert.ok(!ghCalls(world).some((c) => c.includes('--prerelease') || c[1] === 'edit'), 'it never publishes')
})

test('a download that differs from the build fails the run and leaves the draft', () => {
  const world = makeWorld('corrupt')
  const result = run(world, [], { FAKE_GH_MODE: 'corrupt' })
  assert.notEqual(result.status, 0, result.text)
  assert.match(result.text, /downloaded .* has sha256/)
  assert.match(result.text, /gh release delete desktop-v9\.9\.9/)
})

test('a digest that GitHub reports differently fails the run', () => {
  const world = makeWorld('digest')
  const result = run(world, [], { FAKE_GH_MODE: 'bad-digest' })
  assert.notEqual(result.status, 0, result.text)
  assert.match(result.text, /GitHub reports sha256:0{64}/)
})

test('a failing gh stops the run with its message', () => {
  const world = makeWorld('ghfails')
  const result = run(world, [], { FAKE_GH_MODE: 'create-fails' })
  assert.notEqual(result.status, 0, result.text)
  assert.match(result.text, /gh release create failed/)
})

test('notes that name the PC, hold a placeholder or a profile path, are empty or are missing are refused before gh is called', () => {
  const cases = [
    ['host', `Built on ${HOST.toLowerCase()}.\n`, /holds this PC's name/],
    ['placeholder', 'The hash is {{sha256}}.\n', /placeholder/],
    ['profile', 'See C:\\Users\\someone\\notes.\n', /profile path/],
    ['empty', '   \n', /is empty/],
  ]
  for (const [name, text, pattern] of cases) {
    const world = makeWorld(`notes-${name}`)
    fs.writeFileSync(world.notes, text)
    const result = run(world)
    assert.notEqual(result.status, 0, `${name}: ${result.text}`)
    assert.match(result.text, pattern, name)
    assert.deepEqual(ghCalls(world), [], `${name}: gh was not called`)
  }
  const missing = makeWorld('notes-missing')
  fs.rmSync(missing.notes)
  assert.notEqual(run(missing).status, 0)
})

test('an installer that is not the one the build recorded is refused', () => {
  const world = makeWorld('tampered')
  fs.appendFileSync(path.join(world.release, SPACED), 'tampered')
  const result = run(world)
  assert.notEqual(result.status, 0, result.text)
  assert.match(result.text, /differs from the one in .*SHA256SUMS/)
  assert.deepEqual(ghCalls(world), [])
})

test('a tag that is not desktop-vX.Y.Z is refused', () => {
  const world = makeWorld('badtag')
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Tag', `v${VERSION}`, '-NotesFile', world.notes, '-ReleaseDir', world.release, '-DryRun']
  assert.notEqual(spawnSync('powershell', args, { encoding: 'utf8', windowsHide: true }).status, 0)
})
