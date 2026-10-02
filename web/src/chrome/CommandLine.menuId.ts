// The DOM id of one row of a numbered menu. The command line needs it for aria-activedescendant while the menu's code
// (CommandLine.menu.tsx, CommandLine.menus.ts) loads on demand (CommandLine.menus.load.ts), so it sits in the shell.
export function menuOptionId(menuId: string, n: number): string {
  return `${menuId}-opt-${n}`
}
