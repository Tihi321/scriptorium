import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { advance, reviewersFor } from '../src/engine/pipeline/advance'
import { BookStore, countInProgress } from '../src/engine/pipeline/books'
import { formatsForKind, isArticleStory, pickNext, variant } from '../src/engine/pipeline/handlers'
import type { SlotRoom } from '../src/engine/pipeline/handlers'
import { loadPrompt } from '../src/engine/pipeline/prompts'
import { buildArticleHtml, buildArticleMarkdown } from '../src/engine/publish/article'
import { SearchService } from '../src/engine/research/service'
import { TavilyProvider, tavilyRequest } from '../src/engine/research/web'
import type { SearchOptions } from '../src/engine/research/web'
import { initDataFolder } from '../src/engine/store/dataFolder'
import type { IdeaFile } from '../src/engine/store/ideas'
import { ARTICLE_FORMAT_IDS, migrateNewspaper } from '../src/engine/store/migrations'
import { parseTopics } from '../src/engine/store/topics'
import type { TopicRow } from '../src/engine/store/topics'
import { parseMd } from '../src/shared/md'
import type { FormatEntry } from '../src/shared/schemas'
import { formatsSchema, qualitySchema } from '../src/shared/schemas'
import { makePipelineEnv, quietResearchState, seedDir, waitFor } from './helpers'
import type { TestEnv } from './helpers'

const tmp: string[] = []
let env: (TestEnv & { counters: Awaited<ReturnType<typeof makePipelineEnv>>['counters'] }) | undefined
afterEach(async () => {
  await env?.cleanup()
  env = undefined
  for (const d of tmp.splice(0)) await rm(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
})
const tempDir = async (prefix = 'scrip-news-') => {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  tmp.push(dir)
  return dir
}

const seedFormats = async (): Promise<FormatEntry[]> => formatsSchema.parse(parseMd(await readFile(path.join(seedDir, 'config', 'formats.md'), 'utf8')).data).formats
const seedTopics = async (): Promise<TopicRow[]> => parseTopics(await readFile(path.join(seedDir, 'topics.md'), 'utf8'))

describe('the newspaper formats and topics of the seed', () => {
  it('has article and feature-article as one-chapter, humanized, non-fiction article formats for topics of kind article', async () => {
    const formats = await seedFormats()
    for (const [id, words] of [['article', [600, 1800]], ['feature-article', [1800, 4000]]] as const) {
      const f = formats.find((x) => x.id === id)!
      expect(f, id).toBeDefined()
      expect(f).toMatchObject({ enabled: true, nonfiction: true, article: true, humanize: true, max_rounds: 1, chapters: [1, 1], kinds: ['article'], long: false })
      expect(f.words).toEqual(words)
      expect(reviewersFor(f)).toEqual(['fact-checker', 'line-editor', 'copy-editor', 'beta-reader'])
    }
    // no other format is an article, and an article format is for no other kind
    expect(formats.filter((f) => f.article).map((f) => f.id)).toEqual(ARTICLE_FORMAT_IDS)
  })

  it('has a Newspaper section of eight article topics, all switched off', async () => {
    const rows = (await seedTopics()).filter((t) => t.kind === 'article')
    expect(rows.map((t) => t.id)).toEqual(['news-world', 'news-europe', 'news-science', 'news-technology', 'news-culture', 'news-business', 'news-sport', 'news-opinion'])
    expect(new Set(rows.map((t) => t.section))).toEqual(new Set(['Newspaper']))
    expect(rows.every((t) => !t.active)).toBe(true)
  })

  it('routes topics to formats: article topics only get article formats, and no other topic gets one', async () => {
    const formats = await seedFormats()
    expect(formatsForKind(formats, 'article').map((f) => f.id)).toEqual(['article', 'feature-article'])
    for (const kind of ['fiction', 'nonfiction', 'juvenile-fiction', 'juvenile-nonfiction', 'visual-novel', 'interactive-fiction']) {
      expect(formatsForKind(formats, kind).some((f) => f.article), kind).toBe(false)
    }
    expect(formatsForKind(formats, null).some((f) => f.article)).toBe(false)
  })

  it('an article format picks the _article prompts, and a role without one uses its non-fiction prompt', async () => {
    const formats = await seedFormats()
    const article = formats.find((f) => f.id === 'article')!
    expect(variant(article, 'pitch')).toBe('pitch_article')
    expect(variant(formats.find((f) => f.id === 'nonfiction-short')!, 'pitch')).toBe('pitch_nf')
    const dir = await tempDir()
    await initDataFolder(dir, seedDir)
    for (const [role, task] of [['architect', 'pitch'], ['architect', 'research_plan'], ['architect', 'outline'], ['writer', 'draft_chapter'], ['writer', 'rewrite_chapter'], ['humanizer', 'humanize_chapter'], ['publisher', 'publish']] as const) {
      const p = await loadPrompt(dir, role, `${task}_article`)
      expect(p.raw, `${role}/${task}_article`).toContain(`task: ${task}_article`)
    }
    // the fact-checker, line editor and the others have no _article prompt: the non-fiction one answers
    const review = await loadPrompt(dir, 'line-editor', 'review_article')
    expect(review.raw).toBe((await loadPrompt(dir, 'line-editor', 'review_nf')).raw)
    expect((await loadPrompt(dir, 'fact-checker', 'fact_check_article')).raw).toBe((await loadPrompt(dir, 'fact-checker', 'fact_check')).raw)
  })
})

describe('the migration', () => {
  /** A data folder from before the newspaper: the seed without the article formats and the Newspaper section. */
  async function oldFolder(eol = '\n'): Promise<{ dir: string; formats: string; topics: string }> {
    const dir = await tempDir('scrip-news-mig-')
    await initDataFolder(dir, seedDir)
    const formatsFile = path.join(dir, 'config', 'formats.md')
    let formats = await readFile(formatsFile, 'utf8')
    const cut = formats.indexOf('  - id: article\n')
    const end = formats.indexOf('---\n# Formats')
    formats = formats.slice(0, cut) + formats.slice(end)
    formats = formats.replace('\n- `article`:', '\n- `x-removed`:')
    await writeFile(formatsFile, formats.replace(/\n/g, eol))
    const topicsFile = path.join(dir, 'topics.md')
    let topics = await readFile(topicsFile, 'utf8')
    topics = topics.slice(0, topics.indexOf('\n## Newspaper')).trimEnd() + '\n'
    // a row of the owner's own, edited by hand
    topics = topics.replace(/^\| fic-action-and-adventure +\| Action & Adventure +\| fiction +\| no +\| 5/m, (m) => m.replace('| no ', '| yes'))
    await writeFile(topicsFile, topics.replace(/\n/g, eol))
    return { dir, formats: await readFile(formatsFile, 'utf8'), topics: await readFile(topicsFile, 'utf8') }
  }

  it('adds the article formats and the Newspaper section to an old data folder, keeps everything else, and does it once', async () => {
    const { dir, formats: before, topics: topicsBefore } = await oldFolder()
    const first = await initDataFolder(dir, seedDir)
    expect(first.migrated).toHaveLength(2)
    expect(first.migrated[0]).toMatch(/formats\.md: added the newspaper formats \(article, feature-article\)/)
    expect(first.migrated[1]).toMatch(/topics\.md: added the Newspaper section/)
    const formatsAfter = await readFile(path.join(dir, 'config', 'formats.md'), 'utf8')
    const parsed = formatsSchema.parse(parseMd(formatsAfter).data).formats
    expect(parsed.filter((f) => f.article).map((f) => f.id)).toEqual(['article', 'feature-article'])
    expect(parsed.find((f) => f.id === 'article')).toMatchObject({ nonfiction: true, humanize: true, max_rounds: 1, chapters: [1, 1], kinds: ['article'] })
    // the owner's text is kept: everything of the old file is still there in order
    expect(parsed.map((f) => f.id).slice(0, -2)).toEqual((await seedFormats()).filter((f) => !f.article).map((f) => f.id))
    expect(formatsAfter.endsWith(before.slice(before.indexOf('---\n# Formats')))).toBe(true)
    const topicsAfter = await readFile(path.join(dir, 'topics.md'), 'utf8')
    expect(topicsAfter.startsWith(topicsBefore.trimEnd())).toBe(true)
    const rows = parseTopics(topicsAfter)
    expect(rows.find((r) => r.id === 'fic-action-and-adventure')!.active).toBe(true) // the owner's switch stays
    expect(rows.filter((r) => r.kind === 'article').map((r) => r.id)).toEqual((await seedTopics()).filter((r) => r.kind === 'article').map((r) => r.id))
    expect(rows.filter((r) => r.kind === 'article').every((r) => !r.active)).toBe(true)
    // a second start changes nothing
    const second = await initDataFolder(dir, seedDir)
    expect(second.migrated).toEqual([])
    expect(await readFile(path.join(dir, 'config', 'formats.md'), 'utf8')).toBe(formatsAfter)
    expect(await readFile(path.join(dir, 'topics.md'), 'utf8')).toBe(topicsAfter)
  })

  it('keeps the line endings of a file with CRLF, and leaves a fresh folder, a folder with its own article format and a folder with no files alone', async () => {
    const { dir } = await oldFolder('\r\n')
    expect((await migrateNewspaper(dir, seedDir)).changes).toHaveLength(2)
    for (const f of [path.join(dir, 'config', 'formats.md'), path.join(dir, 'topics.md')]) {
      const text = await readFile(f, 'utf8')
      expect(text.replace(/\r\n/g, '')).not.toContain('\n') // every line break is CRLF
    }
    expect(parseTopics(await readFile(path.join(dir, 'topics.md'), 'utf8')).filter((r) => r.kind === 'article')).toHaveLength(8)
    // a fresh folder has both from the seed
    const fresh = await tempDir()
    expect((await initDataFolder(fresh, seedDir)).migrated).toEqual([])
    // the owner's own entry named article is theirs: nothing is added for that id (only feature-article is missing)
    const own = await tempDir()
    await initDataFolder(own, seedDir)
    const file = path.join(own, 'config', 'formats.md')
    let text = await readFile(file, 'utf8')
    text = text.slice(0, text.indexOf('  - id: feature-article')) + text.slice(text.indexOf('---\n# Formats'))
    text = text.replace('guidance: |\n      A researched newspaper article', 'guidance: |\n      MY OWN article')
    await writeFile(file, text)
    const res = await migrateNewspaper(own, seedDir)
    expect(res.changes).toEqual(['config/formats.md: added the newspaper formats (feature-article)'])
    expect(await readFile(file, 'utf8')).toContain('MY OWN article')
    // no files, no seed
    const empty = await tempDir()
    expect((await migrateNewspaper(empty, seedDir)).changes).toEqual([])
    expect((await migrateNewspaper(own, undefined)).changes).toEqual([])
  })
})

const idea = (slug: string, data: Record<string, unknown> = {}): IdeaFile => ({
  slug,
  file: `${slug}.md`,
  title: slug,
  body: '',
  createdMs: 0,
  data: { kind: 'idea', topic: null, status: 'open', source: 'user', format: null, book: null, ...data } as IdeaFile['data']
})

describe('the slots of books and articles', () => {
  const topics = (): TopicRow[] => [
    { id: 'fic', topic: 'Fiction', kind: 'fiction', active: true, target: 0, done: 0, inProgress: 0, section: 'F', line: 1 },
    { id: 'news-science', topic: 'Science', kind: 'article', active: true, target: 0, done: 0, inProgress: 0, section: 'N', line: 2 }
  ]
  it('picks only what has room: an article while the books are full, a book while the articles are full', async () => {
    const formats = await seedFormats()
    const both: SlotRoom = { books: true, articles: true }
    expect(pickNext([], topics(), formats, [], both)?.topic?.id).toBe('fic')
    expect(pickNext([], topics(), formats, [], { books: false, articles: true })?.topic?.id).toBe('news-science')
    expect(pickNext([], topics(), formats, [], { books: true, articles: false })?.topic?.id).toBe('fic')
    expect(pickNext([], topics(), formats, [], { books: false, articles: false })).toBeNull()
    // the owner's stories too: a story for a section is an article, and so is a story that only fixes an article format
    const story = idea('s', { topic: 'news-science', format: 'article' })
    const formatOnly = idea('f', { format: 'feature-article' })
    const book = idea('b', { topic: 'fic' })
    expect(isArticleStory(story, topics()[1], formats)).toBe(true)
    expect(isArticleStory(formatOnly, undefined, formats)).toBe(true)
    expect(isArticleStory(book, topics()[0], formats)).toBe(false)
    expect(pickNext([story, book], topics(), formats, [], { books: false, articles: true })?.idea?.slug).toBe('s')
    expect(pickNext([story, book], topics(), formats, [], { books: true, articles: false })?.idea?.slug).toBe('b')
    expect(pickNext([formatOnly], topics(), formats, [], { books: true, articles: false })).not.toBeNull() // no idea: falls to the topics
    expect(pickNext([formatOnly], [], formats, [], { books: true, articles: false })).toBeNull()
    expect(pickNext([formatOnly], [], formats, [], { books: false, articles: true })?.idea?.slug).toBe('f')
  })

  it('counts open articles apart from open books', async () => {
    const dir = await tempDir()
    const books = new BookStore(dir)
    const mk = (slug: string, stage: string, extra: Record<string, unknown> = {}) => books.create(slug, { title: slug, stage, format: 'x', target_words: 500, ...extra })
    await mk('a', 'drafting')
    await mk('b', 'published')
    await mk('c', 'reviewing', { article: true })
    await mk('d', 'outline', { article: true })
    await mk('e', 'published', { article: true })
    await mk('f', 'rejected', { article: true })
    expect(await countInProgress(books)).toEqual({ books: 1, articles: 2 })
  })

  /** A paused book or article that fills a slot for the whole test. */
  const holder = (dir: string, slug: string, article: boolean) =>
    mkdir(path.join(dir, 'books', slug), { recursive: true }).then(() =>
      writeFile(
        path.join(dir, 'books', slug, 'book.md'),
        `---\nkind: book\nslug: ${slug}\ntitle: ${slug}\nstage: drafting\nround: 0\nformat: ${article ? 'article' : 'short-story'}\ntopic: null\ntopic_name: null\ngenre: x\ntarget_words: 900\n${article ? 'article: true\nnonfiction: true\n' : ''}paused: true\n---\n`
      )
    )
  const startedBooks = async (dir: string) => (await readdir(path.join(dir, 'books'))).filter((s) => s.startsWith('the-sleepy-fox'))
  const settle = (ms = 1200) => new Promise((r) => setTimeout(r, ms))

  it('a full set of books does not hold an article back, and a full set of articles does not hold a book back', async () => {
    // books full (1 of 1, paused): the article starts, no second book does
    env = await makePipelineEnv({ maxBooks: 1, activate: ['fic-mystery-cozy', 'news-science'], beforeStart: (dir) => holder(dir, 'holder-book', false) })
    const slug = await waitFor(async () => ((await startedBooks(env!.dir))[0] && existsSync(path.join(env!.dir, 'books', (await startedBooks(env!.dir))[0]!, 'book.md')) ? (await startedBooks(env!.dir))[0] : null), 20000, 'the article to start')
    expect(parseMd(await readFile(path.join(env.dir, 'books', slug, 'book.md'), 'utf8')).data).toMatchObject({ article: true, nonfiction: true, topic: 'news-science', topic_name: 'Science', format: 'article' })
    await settle()
    const started = (await readdir(path.join(env.dir, 'books'))).filter((s) => s !== 'holder-book')
    for (const s of started) expect(parseMd(await readFile(path.join(env.dir, 'books', s, 'book.md'), 'utf8')).data.article, s).toBe(true) // never a second book
  }, 60000)

  it('articles full (1 of 1, paused): a book starts, and no second article does', async () => {
    env = await makePipelineEnv({ maxBooks: 1, factory: { max_articles_in_progress: 1 }, format: 'short-story', activate: ['fic-mystery-cozy', 'news-science'], beforeStart: (dir) => holder(dir, 'holder-article', true) })
    const slug = await waitFor(async () => ((await startedBooks(env!.dir))[0] && existsSync(path.join(env!.dir, 'books', (await startedBooks(env!.dir))[0]!, 'book.md')) ? (await startedBooks(env!.dir))[0] : null), 20000, 'the book to start')
    expect(parseMd(await readFile(path.join(env.dir, 'books', slug, 'book.md'), 'utf8')).data.article).toBeUndefined()
    await settle()
    for (const s of (await readdir(path.join(env.dir, 'books'))).filter((x) => x !== 'holder-article')) {
      expect(parseMd(await readFile(path.join(env.dir, 'books', s, 'book.md'), 'utf8')).data.article, s).toBeUndefined()
    }
  }, 60000)
})

describe('an article on the mock providers', () => {
  it('is researched as news, humanized, reviewed and published as article.html and article.md, with references, and without a cover or an EPUB', async () => {
    env = await makePipelineEnv({
      format: 'article',
      citations: true,
      humanizer: true,
      coverRenderer: true,
      researchPlan: ['What did the ministry announce this week?'],
      activate: []
    })
    await env.engine.handleCommand({ type: 'setTopicActive', id: 'news-technology', active: true })
    const slug = await waitFor(async () => (await readdir(path.join(env!.dir, 'books')))[0] ?? null, 20000, 'the article folder')
    await waitFor(() => existsSync(path.join(env!.dir, 'books', slug, 'book.md')), 20000, 'book.md')
    await env.engine.handleCommand({ type: 'setTopicActive', id: 'news-technology', active: false }) // one article only
    const dirOf = (...p: string[]) => path.join(env!.dir, 'books', slug, ...p)
    const done = await waitFor(async () => (await env!.engine.snapshot()).books.find((b) => b.slug === slug && ['published', 'rejected', 'failed'].includes(b.stage)), 90000, 'the article to finish')
    expect(done.stage).toBe('published')

    // book.md: an article of the Technology section, one chapter, with its headline and standfirst
    const doc = parseMd(await readFile(dirOf('book.md'), 'utf8'))
    expect(doc.data).toMatchObject({ article: true, nonfiction: true, format: 'article', stage: 'published', topic: 'news-technology', topic_name: 'Technology' })
    expect(doc.data.headline).toBe('The Sleepy Fox')
    expect(String(doc.data.standfirst)).toMatch(/fox who cannot sleep/)
    expect((parseMd(await readFile(dirOf('outline.md'), 'utf8')).data.chapters as unknown[]).length).toBe(1)

    // the page and the markdown, with numbered references from the fact base
    const html = await readFile(dirOf('out', 'article.html'), 'utf8')
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('class="masthead">Scriptorium<')
    expect(html).toContain('<p class="section">Technology</p>')
    expect(html).toContain('<h1>The Sleepy Fox</h1>')
    expect(html).toContain('class="standfirst">A fox who cannot sleep')
    expect(html).toMatch(/By <b>[^<]+<\/b>/)
    expect(html).toContain('<time datetime="')
    expect(html).toContain('<sup class="cite"><a href="#ref-1">1</a></sup>')
    expect(html).toContain('id="ref-1"')
    expect(html).toContain('https://example.test/sea-routes')
    expect(html).toContain('<h2>References</h2>')
    const md = await readFile(dirOf('out', 'article.md'), 'utf8')
    expect(md).toMatch(/^# The Sleepy Fox\n\n\*A fox who cannot sleep/)
    expect(md).toContain('## References')
    expect(md).toContain('[1] Sea routes. https://example.test/sea-routes')

    // no cover, no cover brief, no EPUB, no reader, no Kindle, no cover render request
    for (const f of [['out', 'cover.png'], ['out', 'cover.html'], ['out', `${slug}.epub`], ['out', 'reader'], ['cover-brief.md']]) expect(existsSync(dirOf(...f)), f.join('/')).toBe(false)
    expect(doc.data.cover_png).toBeUndefined()
    expect(env.events.some((e) => e.type === 'cover.render')).toBe(false)
    expect(done).toMatchObject({ medium: 'article', epub: null, coverPng: null, readerDir: null, headline: 'The Sleepy Fox', articlePage: `books/${slug}/out/article.html` })
    expect(done.standfirst).toMatch(/fox who cannot sleep/)

    // the humanizer ran on the article, the fact-checker and the editors reviewed it (and only those)
    expect(env.counters.calls.humanize_chapter).toBe(1)
    expect(parseMd(await readFile(dirOf('chapters', 'ch-01.md'), 'utf8')).data.humanized).toBe(0)
    expect(existsSync(dirOf('reviews', 'book-fact-checker-r0.md'))).toBe(true)
    for (const role of ['line-editor', 'copy-editor', 'beta-reader']) expect(existsSync(dirOf('reviews', `book-${role}-r0.md`)), role).toBe(true)
    for (const role of ['developmental-editor', 'originality-checker', 'continuity-checker']) expect(existsSync(dirOf('reviews', `book-${role}-r0.md`)), role).toBe(false)
    expect(existsSync(dirOf('pitch.md'))).toBe(true)

    // research: the searches asked for recent news, and the notes are the article's own, none in the shared library
    expect(env.counters.searches.length).toBeGreaterThan(0)
    expect(env.counters.searchOptions.every((o) => o.news === true)).toBe(true) // the idea search (3 days) and the research searches (7 days)
    expect(env.counters.searchOptions.some((o) => o.days === 7)).toBe(true)
    expect((await readdir(dirOf('research'))).filter((f) => f.endsWith('.md')).length).toBeGreaterThan(0)
    expect(existsSync(path.join(env.dir, 'research')) ? (await readdir(path.join(env.dir, 'research'))).filter((f) => f.endsWith('.md')) : []).toEqual([])

    // the topic counts it as done, and the library shows no shelf book for it (summary says article)
    const topic = (await env.engine.topics.read()).find((t) => t.id === 'news-technology')!
    expect(topic.done).toBe(1)
    expect(topic.inProgress).toBe(0)
  }, 150000)

  it('an article does not reuse the shared library notes, and a book still does', async () => {
    env = await makePipelineEnv({ activate: [] })
    const { research, books } = env.engine
    await books.create('art', { title: 'Art', stage: 'drafting', format: 'article', target_words: 900, article: true, nonfiction: true })
    await books.create('bk', { title: 'Bk', stage: 'drafting', format: 'short-story', target_words: 900 })
    await research.store.write({ question: 'How long did the sea passage take?', book: null, facts: [{ fact: 'It took about six months.', source: { url: 'https://example.test/shared', title: 'Shared' } }], unverified: false, askedBy: 'test' })
    await research.store.write({ question: 'Who announced the new law?', book: 'art', facts: [{ fact: 'The ministry announced it on Monday.', source: { url: 'https://example.test/own', title: 'Own' } }], unverified: false, askedBy: 'test' })
    expect((await research.store.available('art')).map((n) => n.file)).toEqual(['books/art/research/who-announced-the-new-law.md'])
    expect((await research.store.available('bk')).map((n) => n.file)).toEqual(['research/how-long-did-the-sea-passage-take.md'])
    expect(await research.store.findExact('How long did the sea passage take?', 'art')).toBeNull()
    expect((await research.store.findExact('How long did the sea passage take?', 'bk'))?.file).toBe('research/how-long-did-the-sea-passage-take.md')
    expect(await research.store.isolated('art')).toBe(true)
    expect(await research.store.isolated('bk')).toBe(false)
    expect(await research.store.isolated(null)).toBe(false)
  })
})

describe('the idea generator for the newspaper', () => {
  const lastUserOf = (req: { messages: { role: string; content: string }[] }) => req.messages.filter((m) => m.role === 'user').pop()!.content

  it('searches the news for every active section first and gives the headlines to the generator', async () => {
    env = await makePipelineEnv({
      activate: [],
      lowWater: 3,
      pagesFor: (query) => [{ url: `https://news.example.test/${encodeURIComponent(query)}`, title: `Headline about ${query}`, content: 'Something happened this week. '.repeat(10), inline: true }]
    })
    const seen: string[] = []
    env.mock.on({ task: 'generate_ideas' }, (req) => {
      seen.push(lastUserOf(req))
      return JSON.stringify({ ideas: [{ title: 'Chips race for the grid', topic: 'news-technology', pitch: 'Three firms promise greener power chips; the piece asks whether the claims hold.' }, { title: 'Quake under the Alps', topic: 'news-science', pitch: 'Sensors found a slow slip nobody mapped; the piece follows the team.' }, { title: 'A third article idea', topic: 'news-science', pitch: 'Another real subject with an angle and sources to find.' }] })
    })
    await env.engine.handleCommand({ type: 'setTopicActive', id: 'news-technology', active: true })
    await env.engine.handleCommand({ type: 'setTopicActive', id: 'news-science', active: true })
    await waitFor(() => seen.length > 0, 20000, 'the idea job')
    await env.engine.handleCommand({ type: 'setTopicActive', id: 'news-technology', active: false })
    await env.engine.handleCommand({ type: 'setTopicActive', id: 'news-science', active: false })
    const prompt = seen[0]!
    expect(prompt).toContain('Recent headlines from a news search')
    expect(prompt).toContain('### Technology (news-technology)')
    expect(prompt).toContain('### Science (news-science)')
    expect(prompt).toContain('Headline about Technology news')
    expect(prompt).toContain('news.example.test')
    expect(prompt).toContain('For a topic of kind article')
    expect(prompt).toContain('(article, 0 articles so far)')
    // one news search per active section, each asking for recent news
    expect(env.counters.searches.sort()).toEqual(['Science news', 'Technology news'])
    expect(env.counters.searchOptions.every((o) => o.news === true && o.days === 3)).toBe(true)
    // the generated ideas are for the sections
    const ideas = await waitFor(async () => (await env!.engine.ideas.list()).filter((i) => i.data.source === 'generated'), 20000, 'the generated ideas')
    expect(ideas.every((i) => ['news-technology', 'news-science'].includes(i.data.topic ?? ''))).toBe(true)
  }, 60000)

  it('goes on without a news search provider: the prompt says so, and the job does not fail', async () => {
    env = await makePipelineEnv({ activate: [], lowWater: 2 }, { search: { providers: [] } })
    const seen: string[] = []
    env.mock.on({ task: 'generate_ideas' }, (req) => {
      seen.push(lastUserOf(req))
      return JSON.stringify({ ideas: [{ title: 'Chips race for the grid', topic: 'news-technology', pitch: 'Three firms promise greener power chips; the piece asks whether the claims hold.' }] })
    })
    await env.engine.handleCommand({ type: 'setTopicActive', id: 'news-technology', active: true })
    await waitFor(() => seen.length > 0, 20000, 'the idea job')
    await env.engine.handleCommand({ type: 'setTopicActive', id: 'news-technology', active: false })
    expect(seen[0]).toContain('No news search gave any headline')
    expect(seen[0]).toContain('(no headlines found)')
    await waitFor(async () => (await env!.engine.ideas.list()).some((i) => i.data.source === 'generated'), 20000, 'an idea')
    expect(existsSync(path.join(env.dir, 'jobs', 'failed')) ? (await readdir(path.join(env.dir, 'jobs', 'failed'))).filter((f) => f.startsWith('ideas--')) : []).toEqual([])
  }, 60000)

  it('a section that is not active gets no news search, and book topics only never trigger one', async () => {
    env = await makePipelineEnv({ activate: ['fic-mystery-cozy'], lowWater: 2 })
    await waitFor(() => (env!.counters.calls.generate_ideas ?? 0) > 0, 20000, 'the idea job')
    await env.engine.handleCommand({ type: 'setTopicActive', id: 'fic-mystery-cozy', active: false })
    expect(env.counters.searches).toEqual([])
  }, 60000)

  it('the idea prompt of an old data folder (no {{news}}) still gets the headlines appended', async () => {
    env = await makePipelineEnv({
      activate: [],
      lowWater: 2,
      beforeStart: async (dir) => {
        const file = path.join(dir, 'prompts', 'idea-generator', 'generate_ideas.md')
        // an old prompt: no {{news}} and none of the article paragraph
        const old = (await readFile(file, 'utf8')).replace('{{news}}', '').replace(/\nFor a topic of kind article[^\n]*\n/, '')
        expect(old).not.toContain('kind article')
        await writeFile(file, old)
      }
    })
    const seen: string[] = []
    env.mock.on({ task: 'generate_ideas' }, (req) => {
      seen.push(lastUserOf(req))
      return JSON.stringify({ ideas: [{ title: 'Chips race for the grid', topic: 'news-technology', pitch: 'Three firms promise greener power chips; the piece asks whether the claims hold.' }] })
    })
    await env.engine.handleCommand({ type: 'setTopicActive', id: 'news-technology', active: true })
    await waitFor(() => seen.length > 0, 20000, 'the idea job')
    await env.engine.handleCommand({ type: 'setTopicActive', id: 'news-technology', active: false })
    expect(seen[0]).toContain('Recent headlines from a news search')
    expect(seen[0]!.match(/For a topic of kind article/g)).toHaveLength(1)
  }, 60000)
})

describe('news search parameters', () => {
  it('Tavily gets topic news and the last 7 days for an article search, and no news fields for a book', () => {
    expect(tavilyRequest('ai rules', { limit: 4 })).toEqual({ query: 'ai rules', search_depth: 'basic', max_results: 4, include_answer: false, include_raw_content: false })
    expect(tavilyRequest('ai rules', { news: true })).toMatchObject({ query: 'ai rules', topic: 'news', days: 7 })
    expect(tavilyRequest('ai rules', { news: true, days: 3 })).toMatchObject({ topic: 'news', days: 3 })
    expect(tavilyRequest('ai rules', { news: true, days: 0 })).toMatchObject({ days: 1 })
  })

  it('the Tavily provider sends those fields in its request', async () => {
    const bodies: Record<string, unknown>[] = []
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      return new Response(JSON.stringify({ results: [{ title: 'T', url: 'https://example.test/a', content: 'c' }] }), { status: 200 })
    }) as unknown as typeof fetch
    const p = new TavilyProvider({ apiKey: 'k', fetchImpl })
    await p.search('q', { limit: 3 })
    await p.search('q', { limit: 3, news: true, days: 7 })
    expect(bodies[0]).not.toHaveProperty('topic')
    expect(bodies[0]).not.toHaveProperty('days')
    expect(bodies[1]).toMatchObject({ topic: 'news', days: 7, max_results: 3 })
  })

  it('the search service passes the news options on to the provider, and only when asked', async () => {
    const got: SearchOptions[] = []
    const provider = { id: 'p', pricePerRequest: 0, search: async (_q: string, o: SearchOptions = {}) => (got.push(o), [{ title: 'T', url: 'https://example.test/a', snippet: 's' }]) }
    const svc = new SearchService({ registry: undefined as never, providers: [provider] })
    await svc.search('q', { limit: 2 })
    await svc.search('q', { limit: 2, news: true, days: 5 })
    await svc.search('q', { news: true })
    expect(got[0]).not.toHaveProperty('news')
    expect(got[1]).toMatchObject({ news: true, days: 5 })
    expect(got[2]).toMatchObject({ news: true })
  })
})

describe('the article page', () => {
  const input = {
    headline: 'Chips race <for> the grid',
    standfirst: 'Three firms say their chips cut energy use.',
    section: 'Technology',
    byline: 'Mara Quill',
    date: new Date('2026-10-19T09:30:00Z'),
    body: 'Three firms announced new chips [1].\n\n## The claims\n\nIndependent labs have not tested them [2, 3][9].',
    sources: [
      { n: 1, url: 'https://example.test/a?x=1&y=2', title: 'Chip news', retrieved: '2026-10-19' },
      { n: 2, url: 'https://example.test/b', title: '', retrieved: '2026-10-19' },
      { n: 3, url: 'https://example.test/c', title: 'Lab report', retrieved: '2026-10-18' }
    ]
  }
  it('has the masthead, section, headline, standfirst, byline, date, text and numbered references, all escaped', () => {
    const html = buildArticleHtml(input)
    expect(html).toContain('<h1>Chips race &lt;for&gt; the grid</h1>')
    expect(html).toContain('By <b>Mara Quill</b>')
    expect(html).toContain('19 October 2026')
    expect(html).toContain('<h3>The claims</h3>')
    expect(html).toContain('<a href="#ref-1">1</a>')
    expect(html).toContain('<a href="#ref-2">2</a></sup><sup class="cite"><a href="#ref-3">3</a>')
    expect(html).not.toContain('[9]') // a number with no source is dropped
    expect(html).toContain('<li id="ref-1" value="1">Chip news. <a href="https://example.test/a?x=1&amp;y=2"')
    expect(html).toContain('<li id="ref-2" value="2"><a href="https://example.test/b"')
    expect(html).not.toMatch(/<script/i)
    const md = buildArticleMarkdown(input)
    expect(md.startsWith('# Chips race <for> the grid\n\n*Three firms say')).toBe(true)
    expect(md).toContain('By Mara Quill, Technology, 19 October 2026')
    expect(md).toContain('[3] Lab report. https://example.test/c (retrieved 2026-10-18)')
    // no sources: no references block
    expect(buildArticleHtml({ ...input, sources: [] })).not.toContain('id="references"')
  })
})

describe('the plan of an article', () => {
  it('is a short non-fiction book of one chapter: research and facts first, humanizer before the reviews, four reviewers', async () => {
    const f = (await seedFormats()).find((x) => x.id === 'article')!
    const base = {
      slug: 'a', stage: 'drafting', round: 0, rewriteChapters: [], writerFamily: null, writerAgent: null, format: f, quality: qualitySchema.parse({ kind: 'quality' }), hasPitch: true, outlineChapters: 1, outlineRound: 0, acts: [],
      chapters: new Map([[1, 0]]), fixes: new Map(), totalWords: 900, lengthGate: { status: 'ok' } as { status: string }, reviews: new Map(), actReviewFiles: new Set<string>(), outlineReview: null, chapterChecks: new Map(),
      settled: new Set<number>(), actSummaries: new Set<number>(), actReviews: new Set<number>(), repetitionReport: false, failedJobs: [], nonfiction: true, factbase: new Set([1]), ...quietResearchState()
    }
    const jobs = advance({ ...base, humanize: true, humanized: new Map() }).jobs
    expect(jobs.map((j) => j.task)).toEqual(['humanize_chapter'])
    const reviews = advance({ ...base, humanize: true, humanized: new Map([[1, 0]]) }).jobs
    expect(reviews.map((j) => j.role).sort()).toEqual(['beta-reader', 'copy-editor', 'fact-checker', 'line-editor'])
  })
})
