// Panel 3 of the HOME grid (`3-EQ [B]`) is the launchpad's equity panel (look spec 7.1), not the full
// tear sheet: the grid gives it a quarter of the screen and the API serves it its own light endpoint.
// withHomeEquity wraps the EQ screen so that, in the HOME layout's EQ panel (its dockview id is kept
// when a command replaces the panel), HomeEquityPanel shows; everywhere else the full screen shows.
// The panel's code loads on first use, like every screen (WorkspaceScreens).
import { Suspense, lazy, type ComponentType } from 'react'
import { usePanelActions } from '../../chrome/PanelChrome.actions'
import type { ScreenProps } from '../../chrome/WorkspaceScreens'
import { HOME_EQ } from '../../copy/home'
import { HOME_PANEL_IDS } from '../layouts/layouts'

const HomeEquityPanel = lazy(() => import('./HomeEquityPanel'))

/** True in the HOME layout's equity panel. */
export function isHomeEquityPanel(panelId: string): boolean {
  return panelId === HOME_PANEL_IDS.eq
}

export function withHomeEquity(Full: ComponentType<ScreenProps>): ComponentType<ScreenProps> {
  function HomeAwareEquity(props: ScreenProps) {
    const { panelId } = usePanelActions()
    if (!isHomeEquityPanel(panelId)) return <Full {...props} />
    return (
      <Suspense fallback={<p className="home-eq-note" aria-busy="true">{HOME_EQ.loading}</p>}>
        <HomeEquityPanel {...props} />
      </Suspense>
    )
  }
  HomeAwareEquity.displayName = `withHomeEquity(${Full.displayName ?? Full.name ?? 'Screen'})`
  return HomeAwareEquity
}
