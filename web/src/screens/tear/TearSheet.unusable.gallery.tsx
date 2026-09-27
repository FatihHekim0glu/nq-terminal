// Gallery entry /__gallery/TearSheet.unusable (TASKS 6.4): the tear sheet of the fixture run nt_za_v0_fixture_unbalanced, read
// from the fixture-mode backend. e2e/tear.spec.ts drives its tabs and checks its values against the API.
import { TEAR_GALLERY } from '../../copy/tear'
import TearGallery from './TearGallery'

export default function TearSheetGallery() {
  return <TearGallery code="EQ" context={{ kind: 'run', value: 'nt_za_v0_fixture_unbalanced' }} heading={TEAR_GALLERY.unusableTitle} />
}
