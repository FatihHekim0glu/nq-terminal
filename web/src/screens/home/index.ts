// HOME (TASKS 7.4, look spec 7.1): what the workspace registers.
//   HOME  HomeScreen, the launchpad index a HOME panel shows on its own (Shift+Enter HOME). `HOME <GO>`
//         itself loads the 2x2 grid from src/screens/layouts.
//   EQ    withHomeEquity(<the tear sheet's EQ screen>): the HOME grid's panel 3 shows HomeEquityPanel
//         (GET /api/analytics/.../panel); every other EQ panel shows the full tear sheet.
export { default as HomeScreen, launchpadLines } from './HomeScreen'
export { default as HomeEquityPanel, HomeEquityView } from './HomeEquityPanel'
export { isHomeEquityPanel, withHomeEquity } from './homeVariant'
export { homeNotes, homeStack, homeTarget, homeTiles } from './homeEquity.model'

/** The mnemonics this folder serves, for the screen registry. */
export const HOME_MNEMONICS = Object.freeze({ screen: 'HOME', wraps: 'EQ' } as const)
