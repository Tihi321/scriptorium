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

/** A render that takes longer than this has hung: it fails, and the cover can be made again from the book card. */
const RENDER_TIMEOUT_MS = 30_000

function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const t = new Promise<never>((_r, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took longer than ${RENDER_TIMEOUT_MS / 1000} s`)), RENDER_TIMEOUT_MS)
  })
  return Promise.race([p, t]).finally(() => clearTimeout(timer))
}

/**
 * Renders a cover HTML file to a PNG in a hidden offscreen window and writes it to `outPath`. Only local files are loaded.
 *
 * Windows keeps a window no taller than the screen, so a 2560 px cover window gets a shorter page: the template's
 * panel and text, placed from the bottom of the page, were squeezed and cut off, and the short capture was then
 * stretched to the cover size. So the page size is set through the DevTools protocol (device metrics), independent
 * of the window and of the display's scale, and the screenshot is taken at exactly that size.
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
    await withTimeout(render(win, req), 'the cover render')
  } finally {
    win.destroy()
  }
}

async function render(win: BrowserWindow, req: CoverRequest): Promise<void> {
  await win.loadURL(pathToFileURL(req.htmlPath).href)
  const dbg = win.webContents.debugger
  dbg.attach('1.3')
  try {
    await dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width: req.width, height: req.height, deviceScaleFactor: 1, mobile: false })
    // fonts are system fonts, but wait for them and for two frames of layout at the new size anyway
    const size = (await win.webContents.executeJavaScript(
      '(document.fonts ? document.fonts.ready : Promise.resolve()).then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r([innerWidth, innerHeight])))))'
    )) as [number, number]
    if (size[0] !== req.width || size[1] !== req.height) throw new Error(`the page is ${size[0]}x${size[1]}, not ${req.width}x${req.height}`)
    const shot = (await dbg.sendCommand('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: req.width, height: req.height, scale: 1 },
      captureBeyondViewport: true
    })) as { data: string }
    const png = Buffer.from(shot.data, 'base64')
    if (png.length === 0) throw new Error('the capture came back empty')
    await fs.mkdir(path.dirname(req.outPath), { recursive: true })
    await fs.writeFile(req.outPath, png)
  } finally {
    dbg.detach()
  }
}
