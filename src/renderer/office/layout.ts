/** Where rooms and desks are. Pure data and arithmetic, so it can be tested without Phaser. */

export const WORLD = { w: 960, h: 600 }

/** Vertical offsets inside a desk cell. */
export const OFF = { bubbleBottom: 12, feet: 44, deskTop: 31, role: 64, badge: 73, tag: 82 }

/** One desk cell: bubble zone on top, character and desk, then three label lines. */
export const CELL = { w: 76, h: 90 }
export const ROOM_LABEL_H = 16

export type RoomId = 'idea' | 'writers' | 'editing' | 'archive' | 'research' | 'children' | 'print' | 'break' | 'library'

export interface Room {
  id: RoomId
  label: string
  x: number
  y: number
  w: number
  h: number
  /** Floor colours (checker), as numbers for Phaser. */
  floorA: number
  floorB: number
  /** Wall and sign colour. */
  accent: number
  desks: boolean
}

const ROW_H = 200

export const ROOMS: Room[] = [
  { id: 'idea', label: 'IDEA ROOM', x: 0, y: 0, w: 192, h: ROW_H, floorA: 0x6b5d8f, floorB: 0x64568a, accent: 0xb9a6f0, desks: true },
  { id: 'writers', label: "WRITERS' ROOM", x: 192, y: 0, w: 384, h: ROW_H, floorA: 0x5d7fa0, floorB: 0x567899, accent: 0x9cc7ef, desks: true },
  { id: 'editing', label: 'EDITING DESKS', x: 576, y: 0, w: 384, h: ROW_H, floorA: 0x5f8f7e, floorB: 0x598a78, accent: 0xa6e3c9, desks: true },
  { id: 'archive', label: 'ARCHIVE', x: 0, y: ROW_H, w: 288, h: ROW_H, floorA: 0x8a7458, floorB: 0x826c51, accent: 0xe6c79a, desks: true },
  { id: 'research', label: 'RESEARCH LIBRARY', x: 288, y: ROW_H, w: 288, h: ROW_H, floorA: 0x7a6a8a, floorB: 0x726283, accent: 0xd5b8ee, desks: true },
  { id: 'children', label: "CHILDREN'S CORNER", x: 576, y: ROW_H, w: 384, h: ROW_H, floorA: 0xc08a6a, floorB: 0xb88263, accent: 0xffd1a8, desks: true },
  { id: 'print', label: 'PRINT ROOM', x: 0, y: ROW_H * 2, w: 288, h: ROW_H, floorA: 0x6f7f8c, floorB: 0x677784, accent: 0xb7cbdb, desks: true },
  { id: 'break', label: 'BREAK ROOM', x: 288, y: ROW_H * 2, w: 480, h: ROW_H, floorA: 0x7b9a6a, floorB: 0x739263, accent: 0xc9eab3, desks: false },
  { id: 'library', label: 'LIBRARY', x: 768, y: ROW_H * 2, w: 192, h: ROW_H, floorA: 0x6a5446, floorB: 0x634d40, accent: 0xd9b48f, desks: false }
]

export function roomById(id: RoomId): Room {
  return ROOMS.find((r) => r.id === id)!
}

const ROLE_ROOM: Record<string, RoomId> = {
  'editor-in-chief': 'idea',
  'idea-generator': 'idea',
  architect: 'writers',
  writer: 'writers',
  'developmental-editor': 'editing',
  'line-editor': 'editing',
  'copy-editor': 'editing',
  'beta-reader': 'editing',
  archivist: 'archive',
  'continuity-checker': 'archive',
  'fact-checker': 'archive',
  'originality-checker': 'archive',
  researcher: 'research',
  'child-safety-reviewer': 'children',
  'read-aloud-reviewer': 'children',
  publisher: 'print'
}

export function roomForRole(role: string): RoomId {
  return ROLE_ROOM[role] ?? 'writers'
}

export interface Placement {
  room: RoomId
  /** Top-left of the desk cell. */
  x: number
  y: number
  w: number
  h: number
}

/**
 * Gives every agent a desk cell in the room of its role, in the order agents come in.
 * A full room shrinks its cells' height a little instead of refusing a hire.
 */
export function placeDesks(agents: { id: string; role: string }[]): Map<string, Placement> {
  const byRoom = new Map<RoomId, string[]>()
  for (const a of agents) {
    const room = roomForRole(a.role)
    const list = byRoom.get(room) ?? []
    list.push(a.id)
    byRoom.set(room, list)
  }
  const out = new Map<string, Placement>()
  for (const [roomId, ids] of byRoom) {
    const room = roomById(roomId)
    const innerX = room.x + 4
    const innerY = room.y + ROOM_LABEL_H
    const innerW = room.w - 8
    const innerH = room.h - ROOM_LABEL_H - 4
    const cols = Math.max(1, Math.floor(innerW / CELL.w))
    const rowsFit = Math.max(1, Math.floor(innerH / CELL.h))
    const rows = Math.max(rowsFit, Math.ceil(ids.length / cols))
    const cellH = Math.min(CELL.h, innerH / rows)
    const cellW = Math.min(innerW / cols, CELL.w + 12)
    const offsetX = (innerW - cellW * cols) / 2
    ids.forEach((id, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      out.set(id, { room: roomId, x: innerX + offsetX + col * cellW, y: innerY + row * cellH, w: cellW, h: cellH })
    })
  }
  return out
}

/** Standing spots in the break room for idle agents (feet position). */
export function breakSpot(index: number): { x: number; y: number } {
  const room = roomById('break')
  const perRow = Math.max(1, Math.floor((room.w - 16) / CELL.w))
  const col = index % perRow
  const row = Math.floor(index / perRow)
  const spacing = (room.w - 16) / perRow
  return { x: room.x + 8 + spacing * (col + 0.5), y: room.y + 84 + row * 44 }
}

/** The front door: handovers from `you` or the engine start here. */
export const DOOR = { x: 528, y: ROW_H * 3 - 22 }

export function isRequesterOutside(id: string): boolean {
  return id === 'you' || id === 'engine' || id === 'user'
}
