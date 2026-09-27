// Gallery entry /__gallery/TearSheet.hypothesis (TASKS 6.4): the tear sheet of the fixture hypothesis volmanaged_v0, read
// from the fixture-mode backend. e2e/tear.spec.ts drives its tabs and checks its values against the API.
import { TEAR_GALLERY } from '../../copy/tear'
import TearGallery from './TearGallery'

export default function TearSheetGallery() {
  return <TearGallery code="EQ" context={{ kind: 'hypothesis', value: 'volmanaged_v0' }} heading={TEAR_GALLERY.hypothesisTitle} />
}
