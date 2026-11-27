export interface TocItem {
  label: string
  href?: string
  page?: number
  subitems?: TocItem[]
}

export type PdfDisplayMode = 'single' | 'double-even' | 'double-odd' | 'scroll-v' | 'scroll-h'

export interface PdfReaderState {
  scale: number
  fitMode: 'page' | 'width' | 'custom'
  displayMode: PdfDisplayMode
}

export interface ReaderProps {
  book: {
    id: string
    title: string
    path?: string
    localPath?: string
    downloadUrl?: string
    type: 'local' | 'remote'
    progress?: number | string
    totalPages?: number
    formats?: string[]
    series?: string
  }
  onClose: () => void
  onProgress?: (progress: number | string, percentage?: number) => void
  headers?: any
  basicAuthHeaders?: any
  /** Delete the local copy and download it again (offered when a downloaded book fails to open) */
  onRedownload?: () => void
}
