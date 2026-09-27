// Saves text as a file in the viewer's downloads folder (98) Export on REG and OOS). A local object URL
// only: no request leaves the page and nothing is written anywhere else. Returns false where the
// browser has no object URLs or refuses one, so the caller never reports a save that did not happen.

const CSV_TYPE = 'text/csv;charset=utf-8'

export function saveText(fileName: string, text: string, type: string = CSV_TYPE): boolean {
  if (typeof URL.createObjectURL !== 'function') return false
  let url: string
  try {
    url = URL.createObjectURL(new Blob([text], { type }))
  } catch {
    return false
  }
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.rel = 'noopener'
    link.click()
    return true
  } finally {
    URL.revokeObjectURL(url)
  }
}
