// The Windows clipboard as the owner's machine has it, read and written with PowerShell (no window), so the copy test can
// prove what the app really put there and then give the owner's own text back. Only text is restored: an image or a
// list of files on the clipboard cannot be, which is why the copy test is one short test and nothing else touches it.
import { execFileSync } from 'node:child_process'

const POWERSHELL = ['-NoProfile', '-NonInteractive', '-Sta', '-Command']

function powershell(script: string, input?: string): string {
  return execFileSync('powershell.exe', [...POWERSHELL, script], { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
}

/** The clipboard's text, or null when it holds none. */
export function readClipboardText(): string | null {
  const out = powershell('$t = Get-Clipboard -Raw -Format Text -ErrorAction SilentlyContinue; if ($null -eq $t) { "" } else { [Console]::Out.Write("T" + $t) }')
  return out.startsWith('T') ? out.slice(1) : null
}

/** Puts text on the clipboard; null or an empty text empties it. */
export function writeClipboardText(text: string | null): void {
  if (text === null || text === '') powershell('Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::Clear()')
  else powershell('$t = [Console]::In.ReadToEnd(); Set-Clipboard -Value $t', text)
}
