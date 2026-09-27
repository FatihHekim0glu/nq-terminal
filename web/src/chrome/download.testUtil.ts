// Test helper (imported by *.test.* files only): records what 98) Export and 98) Report save, by
// standing in for the browser's object URLs and the download link's click. `restore` puts both back.
import { vi } from 'vitest'

export interface SavedFile {
  readonly name: string
  readonly blob: Blob
}

export interface DownloadCapture {
  readonly files: SavedFile[]
  /** The text of the saved file called `name` (the last one when saved twice). */
  text(name?: string): Promise<string>
  restore(): void
}

export function captureDownloads(): DownloadCapture {
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
  const files: SavedFile[] = []
  const blobs = new Map<string, Blob>()
  let next = 0
  Object.assign(URL, {
    createObjectURL: (blob: Blob) => {
      next += 1
      const url = `blob:test-${next}`
      blobs.set(url, blob)
      return url
    },
    revokeObjectURL: () => {},
  })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    const blob = blobs.get(this.href)
    if (blob) files.push({ name: this.download, blob })
  })
  return {
    files,
    async text(name?: string) {
      const hit = [...files].reverse().find((f) => name === undefined || f.name === name)
      if (!hit) throw new Error(`no saved file ${name ?? ''}; saved: ${files.map((f) => f.name).join(', ')}`)
      return hit.blob.text()
    },
    restore() {
      click.mockRestore()
      Object.assign(URL, { createObjectURL: original.create, revokeObjectURL: original.revoke })
    },
  }
}
