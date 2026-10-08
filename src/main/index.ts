import { app, BrowserWindow, ipcMain, Menu, nativeImage, powerSaveBlocker, protocol, shell, Tray } from 'electron'
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isCommand } from '../shared/protocol'
import type { EngineEvent } from '../shared/protocol'
import { BOOK_SCHEME } from '../renderer/hostApi'
import { renderCover } from './cover'
import { startEngine } from './engineClient'
import { bookUrlToPath, readFileInside, resolveInside, tailFileInside } from './files'

const EVENT_CHANNEL = 'engine:event'
const COMMAND_CHANNEL = 'engine:command'

let win: BrowserWindow | null = null
let tray: Tray | null = null
let renderingCovers = 0
let quitting = false
let dataDir: string | null = null
let allPaused = false
let loginItemInMemory = false
const runningJobs = new Set<string>()
let blockerId: number | null = null

// SCRIPTORIUM_NO_WINDOW=1 runs the engine and the cover service without the main window (for scripted checks).
const noWindow = process.env.SCRIPTORIUM_NO_WINDOW === '1'
const startHidden = process.argv.includes('--hidden')

// The reader and the covers are served by this scheme, from the data folder only (see files.ts).
protocol.registerSchemesAsPrivileged([{ scheme: BOOK_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])

function forwardedEngineArgs(): string[] {
  const i = process.argv.findIndex((a) => a === '--data')
  const value = i >= 0 ? process.argv[i + 1] : undefined
  const args = value ? ['--data', value] : []
  // The engine cannot find `seed/` from inside the archive, so a packaged app hands it the copy in resources.
  if (app.isPackaged) args.push('--seed', path.join(process.resourcesPath, 'seed'))
  return args
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'Scriptorium',
    backgroundColor: '#12161e',
    show: !startHidden,
    icon: appIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  // Closing the window hides it. The engine keeps working. Quit is in the tray menu.
  w.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      w.hide()
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void w.loadFile(path.join(__dirname, '../renderer/index.html'))
  return w
}

function showWindow(): void {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function appIcon(): Electron.NativeImage | undefined {
  for (const c of [path.join(process.resourcesPath, 'icon.png'), path.join(app.getAppPath(), 'build/icon.png')]) {
    if (existsSync(c)) return nativeImage.createFromPath(c)
  }
  return undefined
}

function trayImage(): Electron.NativeImage {
  const candidates = [
    path.join(process.resourcesPath, 'icon.png'), // packaged
    path.join(app.getAppPath(), 'build/icon.png') // development
  ]
  for (const c of candidates) {
    if (existsSync(c)) {
      const img = nativeImage.createFromPath(c)
      if (!img.isEmpty()) return img.resize({ width: 16, height: 16 })
    }
  }
  // a plain 16x16 square if the picture is missing
  return nativeImage.createFromBuffer(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')).resize({ width: 16, height: 16 })
}

function rebuildTrayMenu(sendCommand: (c: { type: 'pauseAll' | 'resumeAll' }) => void): void {
  if (!tray) return
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: win?.isVisible() ? 'Hide Scriptorium' : 'Show Scriptorium', click: () => (win?.isVisible() ? win.hide() : showWindow()) },
      {
        label: allPaused ? 'Resume all' : 'Pause all',
        click: () => {
          sendCommand({ type: allPaused ? 'resumeAll' : 'pauseAll' })
          allPaused = !allPaused
          rebuildTrayMenu(sendCommand)
        }
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ])
  )
}

function updatePowerBlocker(): void {
  if (runningJobs.size > 0 && blockerId === null) blockerId = powerSaveBlocker.start('prevent-app-suspension')
  else if (runningJobs.size === 0 && blockerId !== null) {
    powerSaveBlocker.stop(blockerId)
    blockerId = null
  }
}

function loginItemOn(): boolean {
  if (process.env.SCRIPTORIUM_NO_LOGIN_ITEM === '1') return loginItemInMemory
  return app.getLoginItemSettings().openAtLogin
}

function setLoginItem(on: boolean): boolean {
  if (process.env.SCRIPTORIUM_NO_LOGIN_ITEM === '1') loginItemInMemory = on
  else {
    // In development this is electron.exe plus the app folder; packaged, it is the app itself.
    const args = app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden']
    app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args })
  }
  return loginItemOn()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())

  void app.whenReady().then(() => {
    const engine = startEngine(path.join(__dirname, '../engine/index.js'), forwardedEngineArgs())
    const sendCommand = (c: Parameters<typeof engine.send>[0]) => engine.send(c)

    protocol.handle(BOOK_SCHEME, async (request) => {
      const hit = dataDir ? bookUrlToPath(dataDir, request.url) : null
      if (!hit) return new Response('not found', { status: 404 })
      try {
        // a link inside the data folder that points elsewhere is refused too
        const real = await fs.realpath(hit.file)
        if (!resolveInside(await fs.realpath(dataDir!), path.relative(await fs.realpath(dataDir!), real))) return new Response('not found', { status: 404 })
        const body = await fs.readFile(real)
        return new Response(new Uint8Array(body), {
          headers: {
            'content-type': hit.type,
            // the reader is plain HTML and CSS: no scripts, no network
            'content-security-policy': "default-src 'none'; style-src 'unsafe-inline' scriptorium-book:; img-src scriptorium-book: data:; font-src scriptorium-book: data:"
          }
        })
      } catch {
        return new Response('not found', { status: 404 })
      }
    })

    engine.onMessage((event: EngineEvent) => {
      if (event.type === 'engine.heartbeat') console.log(`[main] heartbeat #${event.n} relayed (${event.at})`)
      else console.log(`[main] engine event: ${event.type}`)
      if (win && !win.isDestroyed()) win.webContents.send(EVENT_CHANNEL, event)
      switch (event.type) {
        case 'engine.ready':
          dataDir = event.dataDir
          break
        case 'snapshot':
          allPaused = event.paused
          for (const r of event.running) runningJobs.add(r.jobId)
          updatePowerBlocker()
          rebuildTrayMenu(sendCommand)
          break
        case 'factory.paused':
          allPaused = event.paused
          rebuildTrayMenu(sendCommand)
          break
        case 'job.started':
          runningJobs.add(event.jobId)
          updatePowerBlocker()
          break
        case 'job.done':
          runningJobs.delete(event.jobId)
          updatePowerBlocker()
          break
        case 'cover.render':
          renderingCovers++
          renderCover(event)
            .then(() => {
              console.log(`[main] cover rendered: ${event.outPath}`)
              engine.send({ type: 'coverRendered', book: event.book, ok: true })
            })
            .catch((err: Error) => {
              console.error(`[main] cover render failed for ${event.book}: ${err.message}`)
              engine.send({ type: 'coverRendered', book: event.book, ok: false, error: err.message })
            })
            .finally(() => renderingCovers--)
          break
        default:
          break
      }
    })

    ipcMain.on(COMMAND_CHANNEL, (_e, command: unknown) => {
      if (isCommand(command)) engine.send(command)
    })
    ipcMain.handle('host:readFile', (_e, rel: unknown) => (dataDir ? readFileInside(dataDir, rel) : null))
    ipcMain.handle('host:tailFile', (_e, rel: unknown, from: unknown) => (dataDir ? tailFileInside(dataDir, rel, from) : null))
    ipcMain.handle('host:openFolder', async (_e, rel: unknown) => {
      const full = dataDir ? resolveInside(dataDir, rel) : null
      if (!full) return false
      return (await shell.openPath(full)) === ''
    })
    ipcMain.handle('host:getLogin', () => loginItemOn())
    ipcMain.handle('host:setLogin', (_e, on: unknown) => setLoginItem(on === true))

    if (!noWindow) {
      win = createWindow()
      // The renderer asks for a first state once it has loaded.
      win.webContents.on('did-finish-load', () => {
        engine.send({ type: 'ping', id: 'startup' })
        engine.send({ type: 'snapshot' })
      })
      if (process.env.SCRIPTORIUM_NO_TRAY !== '1') {
        tray = new Tray(trayImage())
        tray.setToolTip('Scriptorium')
        tray.on('click', () => (win?.isVisible() ? win.hide() : showWindow()))
        win.on('show', () => rebuildTrayMenu(sendCommand))
        win.on('hide', () => rebuildTrayMenu(sendCommand))
        rebuildTrayMenu(sendCommand)
      }
    }

    // Quit ends the engine.
    app.on('before-quit', (e) => {
      if (quitting) return
      quitting = true
      e.preventDefault()
      if (blockerId !== null) powerSaveBlocker.stop(blockerId)
      // stopNow would leave the factory paused for the next start, so the engine is just ended:
      // jobs that were running are recovered into the queue when it starts again.
      engine.close()
      tray?.destroy()
      setTimeout(() => app.exit(0), 200)
    })
    app.on('window-all-closed', () => {
      // closing the window only hides it; the hidden cover window closing is not the app closing either
      if (noWindow || renderingCovers > 0) return
    })
  })
}
