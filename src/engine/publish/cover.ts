import { promises as fs } from 'node:fs'
import path from 'node:path'
import { atomicWrite } from '../store/atomic'
import { escapeXml } from './xhtml'

export const COVER_WIDTH = 1600
export const COVER_HEIGHT = 2560

const FALLBACK_TEMPLATE = `<!doctype html><html><head><meta charset="utf-8"><title>{{title}}</title></head>
<body class="{{genre_class}}" style="width:1600px;height:2560px;margin:0;background:#2f3e46;color:#f4efe6;font-family:Georgia,serif;text-align:center">
<h1 style="padding-top:900px;font-size:180px">{{title}}</h1><p style="font-size:96px">{{author}}</p><p>{{genre}} {{year}}</p></body></html>`

/** Picks the genre class used by the cover template from the topic name, topic kind and format. */
export function genreClass(opts: { topicName?: string | null; kind?: string | null; format?: string | null }): string {
  const t = (opts.topicName ?? '').toLowerCase()
  const f = opts.format ?? ''
  if (f.startsWith('bedtime')) return 'g-bedtime'
  const rules: [RegExp, string][] = [
    [/fantasy|fairy|myth/, 'g-fantasy'],
    [/mystery|detective|crime|thriller/, 'g-mystery'],
    [/science fiction|space|robot/, 'g-scifi'],
    [/romance/, 'g-romance'],
    [/horror|ghost/, 'g-horror'],
    [/histor/, 'g-historical'],
    [/adventure|western|sea stories|pirate/, 'g-adventure'],
    [/literary|family|coming of age/, 'g-literary'],
    [/humor|silly|funny/, 'g-humor']
  ]
  for (const [re, cls] of rules) if (re.test(t)) return cls
  if ((opts.kind ?? '').startsWith('juvenile')) return 'g-children'
  if (opts.kind === 'nonfiction') return 'g-nonfiction'
  return 'g-literary'
}

export function fillCover(template: string, vars: { title: string; author: string; genre: string; year: number; genreClass: string }): string {
  const map: Record<string, string> = {
    title: escapeXml(vars.title),
    author: escapeXml(vars.author),
    genre: escapeXml(vars.genre),
    year: String(vars.year),
    genre_class: vars.genreClass
  }
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => map[k] ?? '')
}

/** Writes books/<slug>/out/cover.html from templates/cover.html. Returns its path. */
export async function writeCoverHtml(
  dataDir: string,
  slug: string,
  vars: { title: string; author: string; genre: string; year: number; genreClass: string }
): Promise<string> {
  let template = FALLBACK_TEMPLATE
  try {
    template = await fs.readFile(path.join(dataDir, 'templates', 'cover.html'), 'utf8')
  } catch {
    /* use the built-in fallback */
  }
  const out = path.join(dataDir, 'books', slug, 'out', 'cover.html')
  await atomicWrite(out, fillCover(template, vars))
  return out
}
