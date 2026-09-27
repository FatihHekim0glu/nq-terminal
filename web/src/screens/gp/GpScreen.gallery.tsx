// Gallery entry /__gallery/GpScreen: NQ1 Index daily candles over the in-sample maximum, in link
// group A, from the fixture-mode backend (synthetic bars through the fake gate).
import GpGallery from './GpGallery'

export default function GpScreenGallery() {
  return (
    <GpGallery
      params={{ code: 'GP', context: { kind: 'instrument', value: 'NQ' }, args: { timeframe: '1d' }, group: 'A' }}
      title="NQ GP 1d"
      subject="NQ1 Index 1d"
    />
  )
}
