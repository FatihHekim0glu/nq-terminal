// The dossier model (roadmap #15 part 2): the one entry point the evidence pack and the print dossier call.
// A panel hands over the answers it already holds (a tear sheet or a hypothesis description) and gets back
// plain text in sections: nothing is computed, formatted afresh or requested here. The shared parts (the KPI,
// interval and SV7 sections, the flags and the footer) are defined beside the tear sheet builder they were
// written for and re-exported here, so this file, dossierDes.ts and dossierTear.ts never import each other in a ring.
import { desDossier } from './dossierDes'
import { tearDossier } from './dossierTear'
import type { Dossier, DossierContext, DossierInput } from './types'

export { flags, footer, intervalSection, kpiSection, sv7Section } from './dossierTear'

/** The dossier of a tear sheet or of a hypothesis description. */
export function buildDossier(input: DossierInput, ctx: DossierContext): Dossier {
  return input.kind === 'tear' ? tearDossier(input, ctx) : desDossier(input, ctx)
}
