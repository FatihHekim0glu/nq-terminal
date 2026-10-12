// The key names that assistive technology and the message line speak, per platform. The PC wording lives in
// copy/chrome.ts, copy/commands.ts and copy/grab.ts; this file derives the Mac wording, so a Mac laptop user is
// never told to press End, PgUp or Alt (Option and Fn name the same keys there; the Mac table in help.ts agrees).

export type KeyNameTable = 'pc' | 'mac'

/** The official toolbar keys whose accessible name carries a key a Mac laptop lacks, with their Mac names. */
export const MAC_KEY_TOOLBAR_NAMES = {
  pgback: 'PG BACK key, Fn+Up: previous page of the focused panel',
  pgfwd: 'PG FWD key, Fn+Down: next page of the focused panel',
} as const

export const MAC_KEYMAP_NAME = 'Key map, Option+K'

/** Back and Forward: Cmd+[ and Cmd+] are the Mac keys, with the Fn spelling of the PC End keys beside them. */
export const MAC_NAV_NAMES = {
  back: 'Back, Cmd+[ or Fn+Right',
  forward: 'Forward, Cmd+] or Shift+Fn+Right',
} as const

/** A sentence written with PC key names, spoken with the Mac names for a Mac (Option for Alt). */
export function keyWords(text: string, table: KeyNameTable): string {
  return table === 'mac' ? text.replace(/\bAlt\+/g, 'Option+') : text
}
