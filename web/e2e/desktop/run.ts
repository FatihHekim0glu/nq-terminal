// What the global set-up tells the specs (a JSON file named by an environment variable the set-up sets in the main
// process, which the workers inherit).
import fs from 'node:fs'

export const RUN_FILE_ENV = 'NQT_DESKTOP_RUN_FILE'

export interface RunInfo {
  readonly pid: number
  /** `http://127.0.0.1:<port>`: the engine's debugging port, read from DevToolsActivePort. */
  readonly cdpUrl: string
  /** The backend page's origin. */
  readonly origin: string
  readonly runDir: string
  /** `--save-dir`: where downloads land with no dialog. */
  readonly saveDir: string
  readonly stateDir: string
  readonly configDir: string
  readonly watchLog: string
  readonly exe: string
  readonly lab: string
}

export function readRun(): RunInfo {
  const file = process.env[RUN_FILE_ENV]
  if (file === undefined || file === '') throw new Error(`${RUN_FILE_ENV} is not set: run this through playwright.desktop.config.ts`)
  return JSON.parse(fs.readFileSync(file, 'utf8')) as RunInfo
}
