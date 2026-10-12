// Whether web/dist-selftest is still the build of the code the desktop self-test spec judges. The page runs the quant goldens
// and the Perspective, dockview, bridge and API probes, so every file under web/src (tests and galleries aside), the package
// and build files and every golden under qa/golden, at any depth, decide it.
import fs from 'node:fs'
import path from 'node:path'

const TOP_LEVEL_INPUTS = ['package.json', 'pnpm-lock.yaml', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json']
const NOT_SHIPPED = /\.(test|gallery)\./

function filesUnder(folder: string): string[] {
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) return []
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(folder, entry.name)
    if (entry.isDirectory()) return filesUnder(full)
    return entry.isFile() ? [full] : []
  })
}

function inputFiles(webDir: string, terminalDir: string): string[] {
  const topLevel = TOP_LEVEL_INPUTS.map((name) => path.join(webDir, name)).filter((file) => fs.existsSync(file))
  const sources = filesUnder(path.join(webDir, 'src')).filter((file) => !NOT_SHIPPED.test(path.basename(file)))
  return [...topLevel, ...sources, ...filesUnder(path.join(terminalDir, 'qa', 'golden'))]
}

/** The newest modification time (ms since the epoch) among the inputs of the self-test page; 0 when there are none. */
export function newestSelftestInput(webDir: string, terminalDir: string): number {
  return inputFiles(webDir, terminalDir).reduce((newest, file) => Math.max(newest, fs.statSync(file).mtimeMs), 0)
}

/** True when the built page exists and is at least as new as every input. */
export function selftestBuildIsCurrent(indexHtml: string, webDir: string, terminalDir: string): boolean {
  return fs.existsSync(indexHtml) && fs.statSync(indexHtml).mtimeMs >= newestSelftestInput(webDir, terminalDir)
}
