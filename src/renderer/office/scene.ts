import Phaser from 'phaser'
import { officeStore, type OfficeStore } from '../store/store'
import {
  handoverAlpha,
  hexToInt,
  modelNameOf,
  providerColor,
  providerLabel,
  providerOf,
  roleShort,
  type AgentView
} from '../store/model'
import { CELL, DOOR, OFF, ROOMS, ROOM_LABEL_H, WORLD, breakSpot, isRequesterOutside, placeDesks, type Placement } from './layout'
import { hoverStore } from './hover'

const BASE = import.meta.env.BASE_URL
const ASSETS = `${BASE}assets/pixel-office/`

/** Frames cut out of PixelOfficeAssets.png (2dPig, CC0). Source pixel rectangles. */
const FRAMES: Record<string, [number, number, number, number]> = {
  table: [84, 70, 26, 20],
  chair0: [6, 41, 12, 22],
  chair1: [19, 41, 12, 22],
  chair2: [32, 41, 12, 22],
  chair3: [45, 41, 12, 22],
  sofaGrey: [119, 65, 34, 15],
  sofaBlue: [119, 83, 34, 16],
  sofaGreen: [119, 102, 34, 16],
  sofaOrange: [119, 121, 34, 16],
  plant: [170, 64, 14, 20],
  vending1: [159, 123, 24, 34],
  vending2: [184, 126, 24, 31],
  window1: [59, 96, 26, 20],
  window2: [88, 96, 26, 20],
  door: [98, 120, 16, 31],
  clock: [159, 108, 19, 6],
  printer: [233, 106, 16, 19],
  shelf: [3, 68, 73, 24],
  cat: [65, 130, 20, 15],
  dog: [59, 148, 22, 12],
  bins: [116, 143, 40, 14],
  calendar: [234, 81, 17, 11]
}

const PEOPLE = [
  { key: 'person-0', file: 'BoyA.png' },
  { key: 'person-1', file: 'Boyb.png' },
  { key: 'person-2', file: 'Boyc.png' },
  { key: 'person-3', file: 'GirlD.png' },
  { key: 'person-4', file: 'Girle.png' }
]

const PERSON_H = 30
const FONT = 'Consolas, "Courier New", monospace'
const WALK_SPEED = 130

interface TextEntry {
  t: Phaser.GameObjects.Text
  px: number
  pad: [number, number]
}

function hash(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0
  return Math.abs(h)
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '~' : text
}

class Actor {
  readonly person: Phaser.GameObjects.Image
  readonly chair: Phaser.GameObjects.Image
  readonly desk: Phaser.GameObjects.Image
  readonly monitor: Phaser.GameObjects.Rectangle
  readonly role: Phaser.GameObjects.Text
  readonly badge: Phaser.GameObjects.Text
  readonly tag: Phaser.GameObjects.Text
  readonly bubble: Phaser.GameObjects.Text
  readonly icon: Phaser.GameObjects.Graphics
  readonly mark: Phaser.GameObjects.Text
  readonly zone: Phaser.GameObjects.Zone
  x = 0
  y = 0
  home = { x: 0, y: 0 }
  placement?: Placement
  awayIndex = -1
  walking = false
  facing = 1
  phase: number
  view!: AgentView
  shownKey = ''
  bubbleFull = ''
  bubbleLong = false
  alphaTarget = 1

  constructor(
    private readonly scene: OfficeScene,
    readonly id: string,
    personKey: string
  ) {
    this.phase = (hash(id) % 628) / 100
    const chairKey = `chair${hash(id) % 4}`
    this.chair = scene.add.image(0, 0, 'assets', chairKey).setOrigin(0.5, 1).setDepth(3)
    this.person = scene.add.image(0, 0, personKey, 'trim').setOrigin(0.5, 1).setDepth(5)
    const trimH = this.person.frame.height
    this.person.setScale(PERSON_H / trimH)
    this.desk = scene.add.image(0, 0, 'assets', 'table').setOrigin(0.5, 0).setDepth(6).setScale(1.6)
    this.monitor = scene.add.rectangle(0, 0, 12, 7, 0x1b2a3a).setOrigin(0.5, 1).setDepth(7)
    this.role = scene.mkText('', 10, { color: '#ffffff', stroke: '#14181f', strokeThickness: 3, fontStyle: 'bold' }).setOrigin(0.5, 0).setDepth(8)
    this.badge = scene.mkText('', 9, { color: '#ffffff', backgroundColor: '#4d7cff', fontStyle: 'bold' }, [3, 1]).setOrigin(0.5, 0).setDepth(8)
    this.tag = scene.mkText('', 9, { color: '#101010', backgroundColor: '#ffffff', fontStyle: 'bold' }, [3, 1]).setOrigin(0.5, 0).setDepth(8)
    this.bubble = scene.mkText('', 9, { color: '#17202c', backgroundColor: '#ffffff' }, [4, 2]).setOrigin(0.5, 1).setDepth(20)
    this.icon = scene.add.graphics().setDepth(21)
    this.mark = scene.mkText('', 11, { color: '#ffd23f', stroke: '#14181f', strokeThickness: 3, fontStyle: 'bold' }).setOrigin(0.5, 1).setDepth(21)
    this.zone = scene.add.zone(0, 0, 40, 56).setOrigin(0.5, 1).setInteractive({ useHandCursor: true }).setDepth(30)
    this.zone.on('pointerover', (p: Phaser.Input.Pointer) => hoverStore.getState().setHover({ id, x: p.x, y: p.y }))
    this.zone.on('pointermove', (p: Phaser.Input.Pointer) => hoverStore.getState().setHover({ id, x: p.x, y: p.y }))
    this.zone.on('pointerout', () => {
      if (hoverStore.getState().hover?.id === id) hoverStore.getState().setHover(null)
    })
    this.zone.on('pointerdown', () => officeStore.getState().selectAgent(id))
  }

  parts(): Phaser.GameObjects.GameObject[] {
    return [this.person, this.chair, this.desk, this.monitor, this.role, this.badge, this.tag, this.bubble, this.icon, this.mark, this.zone]
  }

  destroy(): void {
    if (hoverStore.getState().hover?.id === this.id) hoverStore.getState().setHover(null)
    this.scene.dropTexts([this.role, this.badge, this.tag, this.bubble, this.mark])
    for (const p of this.parts()) p.destroy()
  }

  /** Called when the store changed: what to show and where the agent belongs. */
  sync(view: AgentView, placement: Placement, awayIndex: number): void {
    this.view = view
    this.placement = placement
    const cx = placement.x + placement.w / 2
    this.home = { x: cx, y: placement.y + OFF.feet }
    this.awayIndex = awayIndex
    const away = awayIndex >= 0

    this.chair.setPosition(cx, placement.y + OFF.feet + 2)
    this.desk.setPosition(cx, placement.y + OFF.deskTop)
    this.monitor.setPosition(cx - 10, placement.y + OFF.deskTop + 9)
    const provider = providerOf(view.model)
    const color = hexToInt(providerColor(provider))
    this.desk.setTint(view.state === 'paused' ? 0x888888 : color)

    this.role.setText(clip(roleShort(view.role), 14))
    this.role.setPosition(cx, placement.y + OFF.role)
    const badgeText = badgeLabel(view.model)
    this.badge.setText(badgeText)
    this.badge.setBackgroundColor(providerColor(provider))
    this.badge.setColor(luminance(providerColor(provider)) > 0.55 ? '#101010' : '#ffffff')
    this.badge.setPosition(cx, placement.y + OFF.badge)
    const book = view.book ? officeStore.getState().books[view.book] : undefined
    this.tag.setVisible(!!book && !away)
    if (book) {
      this.tag.setText(clip(book.title, 14))
      this.tag.setBackgroundColor(book.color)
      this.tag.setColor(luminance(book.color) > 0.5 ? '#101010' : '#ffffff')
    }
    this.tag.setPosition(cx, placement.y + OFF.tag)
    this.badge.setVisible(!away)

    // bubble text
    const s = view.state
    let bubbleText = ''
    let bg = '#ffffff'
    let fg = '#17202c'
    if (s === 'error') {
      bubbleText = view.task ?? 'error'
      bg = '#d63a3a'
      fg = '#ffffff'
    } else if (s === 'working' || s === 'reviewing') {
      bubbleText = view.task ?? ''
    } else if (s === 'waiting-provider') {
      bubbleText = 'waiting for provider'
      bg = '#fff3c4'
    } else if (s === 'waiting-research') {
      bubbleText = view.task ?? 'waiting for research'
      bg = '#e6f0ff'
    }
    const showBubble = bubbleText !== '' && !away
    this.bubble.setVisible(showBubble)
    if (showBubble) {
      this.bubbleFull = bubbleText
      this.bubble.setText(this.bubbleLong ? clip(bubbleText, 48) : clip(bubbleText, 16))
      this.bubble.setBackgroundColor(bg)
      this.bubble.setColor(fg)
    }
    this.shownKey = `${s}|${view.task}`
    this.person.setTint(s === 'paused' ? 0x777777 : 0xffffff)
    this.chair.setTint(s === 'paused' ? 0x777777 : 0xffffff)
    this.mark.setVisible(false)
  }

  /** Called every frame. */
  tick(dt: number, t: number, dimmed: boolean, selected: boolean): void {
    const view = this.view
    if (!view || !this.placement) return
    const away = this.awayIndex >= 0
    const target = away ? breakSpot(this.awayIndex) : this.home
    const dx = target.x - this.x
    const dy = target.y - this.y
    const dist = Math.hypot(dx, dy)
    if (dist > 1) {
      const step = Math.min(dist, WALK_SPEED * dt)
      this.x += (dx / dist) * step
      this.y += (dy / dist) * step
      this.walking = true
      if (Math.abs(dx) > 0.5) this.facing = dx > 0 ? 1 : -1
    } else {
      this.x = target.x
      this.y = target.y
      this.walking = false
    }
    const s = view.state
    const ph = this.phase
    let bob = 0
    let shake = 0
    let angle = 0
    if (this.walking) bob = -Math.abs(Math.sin(t * 14 + ph)) * 2.2
    else if (s === 'working') bob = Math.sin(t * 16 + ph) > 0.2 ? -0.8 : 0
    else if (s === 'reviewing') angle = Math.sin(t * 1.6 + ph) * 4
    else if (s === 'idle') bob = Math.sin(t * 2 + ph) * 0.6
    else if (s === 'error') shake = Math.sin(t * 30) * 0.8
    this.person.setPosition(this.x + shake, this.y + bob).setAngle(angle).setFlipX(this.facing < 0 && this.walking)

    const alpha = (dimmed ? 0.28 : 1) * (s === 'paused' ? 0.7 : 1)
    for (const p of this.parts()) if (p !== this.zone) (p as unknown as Phaser.GameObjects.Components.Alpha).setAlpha(alpha)
    this.zone.setPosition(this.x, this.y)

    // away from the desk: only the role label follows the person
    if (away) {
      this.role.setPosition(this.x, this.y + 2)
    } else {
      this.role.setPosition(this.home.x, this.placement.y + OFF.role)
    }

    // monitor
    const screenOn = !away && (s === 'working' || s === 'reviewing' || s === 'waiting-provider' || s === 'waiting-research' || s === 'error')
    let monitorColor = 0x1b2a3a
    if (screenOn) {
      if (s === 'working') monitorColor = Math.sin(t * 9 + ph) > 0 ? 0x6fe39a : 0x3fb27f
      else if (s === 'reviewing') monitorColor = 0xdde6f5
      else if (s === 'error') monitorColor = 0xd63a3a
      else monitorColor = 0xe0c060
    }
    this.monitor.setFillStyle(monitorColor)

    // icons above the head
    const headY = this.y - PERSON_H - 3
    this.icon.clear()
    this.mark.setVisible(false)
    if (!away && !this.walking) {
      if (s === 'waiting-provider') {
        const flip = Math.floor(t * 1.5) % 2 === 0
        drawHourglass(this.icon, this.x + 13, headY - 2, flip)
      } else if (s === 'waiting-research') {
        const lift = Math.sin(t * 6 + ph) * 1.5
        this.icon.fillStyle(0xf2c9a0, 1).fillRect(this.x + 9, headY + 4 + lift, 3, 8)
        this.icon.fillRect(this.x + 8, headY + 1 + lift, 5, 4)
        this.mark.setText('?').setPosition(this.x - 13, headY + 4).setVisible(true)
      } else if (s === 'reviewing') {
        this.icon.fillStyle(0xffffff, 1).fillRect(this.x - 6, this.y - 12, 12, 8)
        this.icon.fillStyle(0x6a7a90, 1).fillRect(this.x - 5, this.y - 10, 10, 1).fillRect(this.x - 5, this.y - 8, 7, 1)
      } else if (s === 'error') {
        this.mark.setText('!').setColor('#ff5555').setPosition(this.x + 14, headY + 8).setVisible(true)
      }
    }
    const long = selected || hoverStore.getState().hover?.id === this.id
    if (long !== this.bubbleLong) {
      this.bubbleLong = long
      this.bubble.setText(long ? clip(this.bubbleFull, 48) : clip(this.bubbleFull, 16))
    }
    this.bubble.setDepth(long ? 25 : 20)
    if (!away) {
      this.bubble.setPosition(this.x, this.placement.y + OFF.bubbleBottom)
    }
    if (selected) {
      this.icon.lineStyle(1, 0xffe066, 1).strokeRect(this.home.x - CELL.w / 2 + 6, this.placement.y + 2, CELL.w - 12, this.placement.h - 4)
    }
    this.chair.setVisible(!away || true)
  }
}

function badgeLabel(model: string | null): string {
  const provider = providerOf(model)
  if (!model) return providerLabel(provider)
  if (provider === 'lmstudio') return 'LM Studio local'
  if (provider === 'strata') return 'Strata local'
  const name = modelNameOf(model).replace(new RegExp(`^${provider}-?`), '')
  return clip(`${providerLabel(provider)} ${name}`, 20)
}

function luminance(hex: string): number {
  const n = hexToInt(hex)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

function drawHourglass(g: Phaser.GameObjects.Graphics, x: number, y: number, flip: boolean): void {
  g.fillStyle(0xffffff, 1)
  g.fillRect(x - 4, y - 1, 9, 2)
  g.fillRect(x - 4, y + 11, 9, 2)
  g.fillStyle(0x9ad1ff, 1)
  g.fillTriangle(x - 3, y + 1, x + 3, y + 1, x, y + 6)
  g.fillTriangle(x, y + 6, x - 3, y + 11, x + 3, y + 11)
  g.fillStyle(0xf2c14e, 1)
  if (flip) g.fillTriangle(x - 2, y + 1, x + 2, y + 1, x, y + 4)
  else g.fillTriangle(x - 2, y + 11, x + 2, y + 11, x, y + 8)
}

export class OfficeScene extends Phaser.Scene {
  private actors = new Map<string, Actor>()
  private texts: TextEntry[] = []
  private zoom = 1
  private lastVersion = -1
  private away = new Map<string, number>()
  private handoverGfx!: Phaser.GameObjects.Graphics
  private handoverLabels = new Map<string, Phaser.GameObjects.Text>()
  private personKeys: string[] = []
  private ready = false

  constructor() {
    super('office')
  }

  preload(): void {
    this.load.image('assets', `${ASSETS}PixelOfficeAssets.png`)
    for (const p of PEOPLE) this.load.image(p.key, `${ASSETS}people/${p.file}`)
    this.load.on('loaderror', (file: { key: string }) => console.warn('[office] could not load', file.key))
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x1d2330)
    this.buildTextures()
    this.drawRooms()
    this.handoverGfx = this.add.graphics().setDepth(40)
    this.scale.on('resize', () => this.fit())
    this.fit()
    this.ready = true
    ;(window as unknown as { __office?: unknown }).__office = {
      /** Screen position (CSS px, relative to the canvas) of an agent, for tests. */
      agentPos: (id: string) => {
        const a = this.actors.get(id)
        if (!a) return null
        const cam = this.cameras.main
        return { x: (a.x - cam.worldView.x) * cam.zoom, y: (a.y - 12 - cam.worldView.y) * cam.zoom }
      },
      agentCount: () => this.actors.size,
      debug: () => [...this.actors.values()].map((a) => ({ id: a.id, state: a.view?.state, x: Math.round(a.x), y: Math.round(a.y), away: a.awayIndex, walking: a.walking }))
    }
  }

  /** Makes textures for frames, trims the people, and builds plain-shape stand-ins when files are missing. */
  private buildTextures(): void {
    const tex = this.textures
    if (tex.exists('assets')) {
      const t = tex.get('assets')
      for (const [name, [x, y, w, h]] of Object.entries(FRAMES)) t.add(name, 0, x, y, w, h)
    } else {
      const g = this.make.graphics({}, false)
      g.fillStyle(0xffffff, 1).fillRect(0, 0, 26, 20)
      g.generateTexture('assets', 26, 20)
      g.destroy()
      tex.get('assets').add('table', 0, 0, 0, 26, 20)
      for (const name of Object.keys(FRAMES)) if (name !== 'table') tex.get('assets').add(name, 0, 0, 0, 1, 1)
    }
    this.personKeys = []
    PEOPLE.forEach((p, i) => {
      if (tex.exists(p.key)) {
        const t = tex.get(p.key)
        const bbox = opaqueBounds(t.getSourceImage() as HTMLImageElement)
        t.add('trim', 0, bbox.x, bbox.y, bbox.w, bbox.h)
      } else {
        const g = this.make.graphics({}, false)
        const colors = [0x6aa6e8, 0xe87a6a, 0x7ad18a, 0xe8c76a, 0xb88ae8]
        g.fillStyle(colors[i % colors.length]!, 1).fillRect(2, 8, 12, 16).fillStyle(0xf2c9a0, 1).fillRect(3, 0, 10, 9)
        g.generateTexture(p.key, 16, 24)
        g.destroy()
        tex.get(p.key).add('trim', 0, 0, 0, 16, 24)
      }
      this.personKeys.push(p.key)
    })
  }

  mkText(text: string, px: number, style: Phaser.Types.GameObjects.Text.TextStyle, pad: [number, number] = [0, 0]): Phaser.GameObjects.Text {
    const t = this.add.text(0, 0, text, { fontFamily: FONT, fontSize: `${px}px`, ...style })
    const entry: TextEntry = { t, px, pad }
    this.texts.push(entry)
    this.styleText(entry)
    return t
  }

  dropTexts(list: Phaser.GameObjects.Text[]): void {
    this.texts = this.texts.filter((e) => !list.includes(e.t))
  }

  private styleText(e: TextEntry): void {
    e.t.setFontSize(e.px / this.zoom)
    e.t.setResolution(Math.max(1, this.zoom * (window.devicePixelRatio || 1)))
    e.t.setPadding(e.pad[0] / this.zoom, e.pad[1] / this.zoom)
    const stroke = e.t.style.strokeThickness
    if (stroke) e.t.setStroke(e.t.style.stroke as string, 3 / this.zoom)
  }

  private fit(): void {
    const { width, height } = this.scale
    const fit = Math.min(width / WORLD.w, height / WORLD.h)
    const zoom = Math.max(0.25, Math.floor(fit * 8) / 8)
    this.cameras.main.setZoom(zoom)
    this.cameras.main.centerOn(WORLD.w / 2, WORLD.h / 2)
    if (zoom !== this.zoom) {
      this.zoom = zoom
      for (const e of this.texts) this.styleText(e)
    }
  }

  private drawRooms(): void {
    const g = this.add.graphics().setDepth(0)
    const wall = this.add.graphics().setDepth(1)
    for (const r of ROOMS) {
      for (let ty = 0; ty < r.h / 16; ty++) {
        for (let tx = 0; tx < r.w / 16; tx++) {
          g.fillStyle((tx + ty) % 2 === 0 ? r.floorA : r.floorB, 1).fillRect(r.x + tx * 16, r.y + ty * 16, Math.min(16, r.w - tx * 16), Math.min(16, r.h - ty * 16))
        }
      }
      // wall band with the room name
      wall.fillStyle(0x262d3b, 1).fillRect(r.x, r.y, r.w, ROOM_LABEL_H)
      wall.fillStyle(r.accent, 1).fillRect(r.x, r.y + ROOM_LABEL_H - 2, r.w, 2)
      const label = this.mkText(r.label, 9, { color: '#' + r.accent.toString(16).padStart(6, '0'), fontStyle: 'bold' })
      label.setPosition(r.x + 6, r.y + 3).setDepth(2)
    }
    // room borders
    wall.lineStyle(2, 0x10141c, 1)
    for (const r of ROOMS) wall.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2)
    this.decorate()
  }

  private deco(frame: string, x: number, y: number, scale = 1, depth = 2): Phaser.GameObjects.Image {
    return this.add.image(x, y, 'assets', frame).setOrigin(0.5, 1).setScale(scale).setDepth(depth)
  }

  private decorate(): void {
    const room = (id: string) => ROOMS.find((r) => r.id === id)!
    const idea = room('idea')
    const bucketX = idea.x + idea.w / 2
    this.deco('bins', bucketX, idea.y + idea.h - 6, 1.2, 2)
    const w = room('writers')
    this.deco('plant', w.x + w.w - 12, w.y + w.h - 6, 1, 2)
    const ed = room('editing')
    this.deco('plant', ed.x + ed.w - 12, ed.y + ed.h - 6, 1, 2)
    const ar = room('archive')
    this.deco('shelf', ar.x + 70, ar.y + 44, 0.9, 1.5)
    this.deco('shelf', ar.x + 210, ar.y + 44, 0.9, 1.5)
    const re = room('research')
    this.deco('shelf', re.x + 70, re.y + 44, 0.9, 1.5)
    this.deco('shelf', re.x + 210, re.y + 44, 0.9, 1.5)
    const ch = room('children')
    this.deco('cat', ch.x + ch.w - 60, ch.y + ch.h - 10, 1, 2)
    this.deco('dog', ch.x + ch.w - 28, ch.y + ch.h - 8, 1, 2)
    this.deco('plant', ch.x + ch.w - 12, ch.y + 52, 1, 2)
    const pr = room('print')
    this.deco('printer', pr.x + pr.w - 22, pr.y + pr.h - 8, 1.4, 2)
    this.deco('calendar', pr.x + pr.w - 60, pr.y + 36, 1.4, 1.5)
    const br = room('break')
    this.deco('sofaBlue', br.x + 70, br.y + 38, 1.5, 2)
    this.deco('sofaOrange', br.x + 160, br.y + 38, 1.5, 2)
    this.deco('sofaGreen', br.x + 250, br.y + 38, 1.5, 2)
    this.deco('vending1', br.x + 390, br.y + 52, 1.2, 2)
    this.deco('vending2', br.x + 432, br.y + 50, 1.2, 2)
    this.deco('clock', br.x + 330, br.y + 28, 1.2, 2)
    this.deco('plant', br.x + br.w - 10, br.y + br.h - 6, 1, 2)
    this.deco('door', DOOR.x, DOOR.y + 22, 1, 2)
    const lib = room('library')
    this.deco('shelf', lib.x + 56, lib.y + 56, 0.9, 1.5)
    this.deco('shelf', lib.x + 136, lib.y + 56, 0.9, 1.5)
    this.mkText('front door', 8, { color: '#cfd8e8' }).setOrigin(0.5, 0).setPosition(DOOR.x + 30, DOOR.y + 4).setDepth(3)
    this.mkText('idea bucket', 8, { color: '#e8dcff' }).setOrigin(0.5, 0).setPosition(bucketX, idea.y + idea.h - 2).setDepth(3)
    this.mkText('click to open the library', 9, { color: '#f0dcc0', align: 'center', fontStyle: 'bold', wordWrap: { width: 150 } })
      .setOrigin(0.5, 0)
      .setPosition(lib.x + lib.w / 2, lib.y + 72)
      .setDepth(3)
    this.add
      .zone(lib.x, lib.y, lib.w, lib.h)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true })
      .setDepth(1)
      .on('pointerdown', () => officeStore.getState().setView('library'))
  }

  update(time: number, delta: number): void {
    if (!this.ready) return
    const state = officeStore.getState()
    if (state.version !== this.lastVersion) {
      this.lastVersion = state.version
      this.syncAgents(state)
    }
    const dt = Math.min(delta, 100) / 1000
    const t = time / 1000
    for (const a of this.actors.values()) {
      a.tick(dt, t, state.highlightBook !== null && a.view?.book !== state.highlightBook, state.selectedAgent === a.id)
    }
    this.drawHandovers(state, Date.now(), t)
  }

  private syncAgents(state: OfficeStore): void {
    const list = state.agentOrder.map((id) => state.agents[id]).filter((a): a is AgentView => !!a)
    const placements = placeDesks(list)
    // break-room spots for idle agents, kept stable while the agent stays idle
    const idleIds = new Set(list.filter((a) => a.state === 'idle').map((a) => a.id))
    for (const id of [...this.away.keys()]) if (!idleIds.has(id)) this.away.delete(id)
    const used = new Set(this.away.values())
    for (const a of list) {
      if (a.state !== 'idle' || this.away.has(a.id)) continue
      let i = 0
      while (used.has(i)) i++
      used.add(i)
      this.away.set(a.id, i)
    }
    const seen = new Set<string>()
    list.forEach((view, n) => {
      const placement = placements.get(view.id)
      if (!placement) return
      seen.add(view.id)
      let actor = this.actors.get(view.id)
      if (!actor) {
        actor = new Actor(this, view.id, this.personKeys[hash(view.id) % this.personKeys.length]!)
        this.actors.set(view.id, actor)
        const home = { x: placement.x + placement.w / 2, y: placement.y + OFF.feet }
        const awayIdx = this.away.get(view.id) ?? -1
        const start = awayIdx >= 0 ? breakSpot(awayIdx) : home
        actor.x = start.x
        actor.y = start.y
        void n
      }
      actor.sync(view, placement, this.away.get(view.id) ?? -1)
    })
    for (const [id, actor] of this.actors) {
      if (!seen.has(id)) {
        actor.destroy()
        this.actors.delete(id)
      }
    }
  }

  private endpoint(id: string): { x: number; y: number } | null {
    if (isRequesterOutside(id)) return { x: DOOR.x, y: DOOR.y + 4 }
    const all = [...this.actors.values()]
    // `from` can also be a role label such as `architect` or `editors`: use an agent of that role
    const a =
      this.actors.get(id) ??
      all.find((x) => x.view?.name === id) ??
      all.find((x) => x.view?.role === id) ??
      (id === 'editors' ? all.find((x) => x.view?.role.endsWith('-editor')) : undefined)
    return a ? { x: a.x, y: a.y - PERSON_H - 2 } : null
  }

  private drawHandovers(state: OfficeStore, now: number, t: number): void {
    const g = this.handoverGfx
    g.clear()
    const live = new Set<string>()
    for (const h of state.handovers) {
      let alpha = handoverAlpha(h, now)
      if (alpha <= 0) continue
      // A handover that has been running for a while stays as a faint line, so a busy office is not a tangle.
      const fresh = h.doneAt !== undefined || now - h.startedAt < 6000 || state.selectedAgent === h.from || state.selectedAgent === h.to
      if (!fresh) alpha *= 0.15
      const a = this.endpoint(h.from)
      const b = this.endpoint(h.to)
      if (!a || !b) continue
      live.add(h.key)
      const color = h.doneAt ? 0x9fe3b0 : 0x7df3ff
      g.lineStyle(2 / Math.max(this.zoom, 1), color, 0.85 * alpha)
      g.beginPath().moveTo(a.x, a.y).lineTo(b.x, b.y).strokePath()
      // arrow head
      const ang = Math.atan2(b.y - a.y, b.x - a.x)
      g.fillStyle(color, alpha)
      g.fillTriangle(b.x, b.y, b.x - Math.cos(ang - 0.45) * 7, b.y - Math.sin(ang - 0.45) * 7, b.x - Math.cos(ang + 0.45) * 7, b.y - Math.sin(ang + 0.45) * 7)
      // a packet travelling along the line while the work is handed over
      if (!h.doneAt) {
        const p = (t * 0.6 + (hash(h.key) % 10) / 10) % 1
        g.fillStyle(0xffffff, 1).fillCircle(a.x + (b.x - a.x) * p, a.y + (b.y - a.y) * p, 2.5)
      }
      let label = this.handoverLabels.get(h.key)
      if (!fresh) {
        label?.setVisible(false)
        continue
      }
      if (!label) {
        label = this.mkText('', 8, { color: '#0b2b33', backgroundColor: '#7df3ff', fontStyle: 'bold' }, [3, 1]).setOrigin(0.5, 0.5).setDepth(41)
        this.handoverLabels.set(h.key, label)
      }
      label.setVisible(true).setText(clip(h.label, 26)).setBackgroundColor(h.doneAt ? '#9fe3b0' : '#7df3ff').setAlpha(alpha)
      label.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2)
    }
    for (const [key, label] of this.handoverLabels) {
      if (!live.has(key)) {
        this.dropTexts([label])
        label.destroy()
        this.handoverLabels.delete(key)
      }
    }
  }
}

/** Bounding box of the non-transparent pixels of an image. */
function opaqueBounds(img: HTMLImageElement): { x: number; y: number; w: number; h: number } {
  const w = img.width
  const h = img.height
  try {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return { x: 0, y: 0, w, h }
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, w, h).data
    let minX = w
    let minY = h
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if ((data[(y * w + x) * 4 + 3] ?? 0) > 8) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) return { x: 0, y: 0, w, h }
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
  } catch {
    return { x: 0, y: 0, w, h }
  }
}

export interface OfficeHandle {
  destroy(): void
  /** Call when the parent element changed size without a window resize (for example the terminal opening). */
  refresh(): void
}

export function createOffice(parent: HTMLElement): OfficeHandle {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#1d2330',
    pixelArt: true,
    roundPixels: true,
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    scene: [OfficeScene],
    input: { mouse: { preventDefaultWheel: false } },
    banner: false
  })
  return {
    destroy: () => game.destroy(true),
    refresh: () => {
      game.scale.getParentBounds()
      game.scale.refresh()
    }
  }
}

