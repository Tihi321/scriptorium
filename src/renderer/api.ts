import type { Command, EngineEvent, ScriptoriumApi } from '../shared/protocol'
import { bookFileUrl, type HostApi } from './hostApi'
import { officeStore } from './store/store'

/**
 * File reads the terminal needs (log and job files in the data folder). Paths are relative to the data folder.
 * Main and preload do not offer these yet, so everything here tolerates their absence.
 */
export interface FileApi {
  /** The whole file as UTF-8 text, or null when it does not exist. */
  readFile(rel: string): Promise<string | null>
  /**
   * Text from a byte offset to the end of the file, with the file's size.
   * A negative `fromByte` means "the last N bytes", so a huge log is not read whole.
   */
  tailFile(rel: string, fromByte: number): Promise<{ text: string; size: number } | null>
}

/** The host (Electron preload) API. Every extra is optional, because the browser harness supplies only some. */
export type RendererApi = ScriptoriumApi & Partial<HostApi> & { bookUrl?(rel: string): string }

declare global {
  interface Window {
    scriptorium: RendererApi
  }
}

export function sendCommand(command: Command): void {
  window.scriptorium.send(command)
}

export const files: FileApi = {
  async readFile(rel) {
    const fn = window.scriptorium.readFile
    return fn ? fn.call(window.scriptorium, rel) : null
  },
  async tailFile(rel, fromByte) {
    const api = window.scriptorium
    if (api.tailFile) return api.tailFile(rel, fromByte)
    if (api.readFile) {
      const text = await api.readFile(rel)
      return text === null ? null : { text, size: text.length }
    }
    return null
  }
}

/**
 * Connects the store to the engine: events are queued and applied every 50 ms,
 * so a burst of streamed tokens causes one render, not hundreds.
 * Returns a function that disconnects.
 */
export function connectEngine(api: RendererApi = window.scriptorium): () => void {
  let queue: EngineEvent[] = []
  let scheduled = false
  const flush = () => {
    scheduled = false
    const batch = queue
    queue = []
    officeStore.getState().applyEvents(batch)
  }
  const off = api.on((event) => {
    queue.push(event)
    if (!scheduled) {
      scheduled = true
      setTimeout(flush, 50)
    }
  })
  api.send({ type: 'snapshot' })
  return () => {
    off()
    queue = []
  }
}

/** URL of a file under `books/<slug>/out/` (cover, reader). The harness can replace it. */
export function bookUrl(rel: string): string {
  return window.scriptorium.bookUrl ? window.scriptorium.bookUrl(rel) : bookFileUrl(rel)
}

export async function openFolder(rel: string): Promise<boolean> {
  return (await window.scriptorium.openFolder?.(rel)) ?? false
}

export async function getStartWithWindows(): Promise<boolean | null> {
  return (await window.scriptorium.getStartWithWindows?.()) ?? null
}

export async function setStartWithWindows(on: boolean): Promise<boolean | null> {
  return (await window.scriptorium.setStartWithWindows?.(on)) ?? null
}
