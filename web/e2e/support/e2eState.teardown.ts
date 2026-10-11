// Global teardown of the Playwright run (playwright.config.ts): removes the backend's state folder this run marked.
// Runs whether the tests passed or failed. The backend still holds its lock when this runs, so a first pass usually
// finds the folder busy; a detached cleaner (e2eState.ts clean) then waits for the backend to stop and finishes the
// removal. Only a folder carrying this run's own marker is ever removed.
import { spawn } from 'node:child_process'
import { SCRIPT_PATH, ownerFromEnv, removeOwnState } from './e2eState.ts'

export default function globalTeardown(): void {
  const owner = ownerFromEnv(process.env)
  if (owner === null) return
  if (removeOwnState(owner.folder, owner.runId) !== 'busy') return
  // Detached and silent: it outlives this runner, which is the point (the backend stops with the runner).
  const cleaner = spawn(process.execPath, [SCRIPT_PATH, 'clean', owner.folder, owner.runId], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  cleaner.on('error', (error) => {
    console.warn(`e2e state teardown: could not start the cleaner for ${owner.folder}: ${error.message}`)
  })
  cleaner.unref()
}
