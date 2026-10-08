import { BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export interface CoverRequest {
  book: string
  htmlPath: string
  outPath: string
  width: number
  height: number
}

/**
 * Renders a cover HTML file to a PNG in a hidden window and writes it to `outPath`.
 * Offscreen rendering makes the size independent of the screen. Only local files are loaded.
 */
export async function renderCover(req: CoverRequest): Promise<void> {
  const win = new BrowserWindow({
    show: false,
    width: req.width,
    height: req.height,
    useContentSize: true,
    frame: false,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true }
  })
  try {
    win.webContents.setFrameRate(1)
    await win.loadURL(pathToFileURL(req.htmlPath).href)
    // fonts are system fonts, but wait for layout anyway
    await win.webContents.executeJavaScript('document.fonts ? document.fonts.ready.then(() => true) : true')
    await new Promise((r) => setTimeout(r, 300))
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: req.width, height: req.height })
    if (image.isEmpty()) throw new Error('the capture came back empty')
    const size = image.getSize()
    // the capture can be scaled on a high-DPI display: bring it to the requested size
    const out = size.width === req.width && size.height === req.height ? image : image.resize({ width: req.width, height: req.height, quality: 'best' })
    await fs.mkdir(path.dirname(req.outPath), { recursive: true })
    await fs.writeFile(req.outPath, out.toPNG())
  } finally {
    win.destroy()
  }
}
