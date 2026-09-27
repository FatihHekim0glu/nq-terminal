// Gallery entry /__gallery/DesInstrument: the NQ1 Index description (command index, health and the
// fixture catalog; no prices are served).
import DesGallery from './DesGallery'

export default function DesInstrumentGallery() {
  return <DesGallery context={{ kind: 'instrument', value: 'NQ' }} title="NQ DES" />
}
