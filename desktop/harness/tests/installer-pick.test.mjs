// The installer size row is the release installer. The release folder also holds the measure and the install-test installers,
// built after it and so newer; the row must not read them. Born failing: findInstaller took the newest of all three.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findInstaller } from '../modes/installer.mjs'

test('findInstaller skips the measure and install-test installers however new they are', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pick-'))
  try {
    const dir = path.join(root, '0.1.2')
    fs.mkdirSync(dir)
    const now = Date.now()
    const write = (name, ageS) => { const f = path.join(dir, name); fs.writeFileSync(f, 'x'); const t = new Date(now - ageS * 1000); fs.utimesSync(f, t, t) }
    write('nq-lab terminal_0.1.2_x64-setup.exe', 300)
    write('nq-lab terminal measure_0.1.2_x64-setup.exe', 200)
    write('nq-lab terminal installtest_0.1.2_x64-setup.exe', 100)
    assert.equal(path.basename(findInstaller(root)), 'nq-lab terminal_0.1.2_x64-setup.exe')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
