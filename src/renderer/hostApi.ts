/**
 * What Electron main adds to `window.scriptorium` besides the engine events and commands (see src/preload/index.ts).
 * Types only, so the preload and the renderer can both import it.
 */
export interface HostApi {
  /** The whole file as UTF-8 text, relative to the data folder. Null when missing or outside the folder. */
  readFile(rel: string): Promise<string | null>
  /** Text from a byte offset to the end, with the file size. A negative offset means the last N bytes. */
  tailFile(rel: string, fromByte: number): Promise<{ text: string; size: number } | null>
  /** Opens a folder inside the data folder in Explorer. */
  openFolder(rel: string): Promise<boolean>
  getStartWithWindows(): Promise<boolean>
  setStartWithWindows(on: boolean): Promise<boolean>
}

/** The custom protocol that serves a book's `out/` files (cover, reader) from the data folder. */
export const BOOK_SCHEME = 'scriptorium-book'

export function bookFileUrl(rel: string): string {
  return `${BOOK_SCHEME}://data/${rel.split('/').map(encodeURIComponent).join('/')}`
}
