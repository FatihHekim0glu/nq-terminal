// Gallery entry /__gallery/GipScreen: NQ1 Index 1m bars for the 2011-01-20 session, which qa.day_gate
// rejected on the vendor variant (fixture-mode backend).
import GpGallery from './GpGallery'

export default function GipScreenGallery() {
  return (
    <GpGallery
      params={{ code: 'GIP', context: { kind: 'instrument', value: 'NQ' }, args: { date: '2011-01-20' }, group: '-' }}
      title="NQ GIP 2011-01-20"
      subject="NQ1 Index 2011-01-20"
    />
  )
}
