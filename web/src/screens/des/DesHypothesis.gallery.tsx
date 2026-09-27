// Gallery entry /__gallery/DesHypothesis: the overnight_v0 tear sheet (the fixture registry's PASS row),
// from the fixture-mode backend.
import DesGallery from './DesGallery'

export default function DesHypothesisGallery() {
  return <DesGallery context={{ kind: 'hypothesis', value: 'overnight_v0' }} title="overnight_v0 DES" group="B" />
}
