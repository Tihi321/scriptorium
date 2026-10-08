import { expect, test, type Page } from '@playwright/test'

interface OfficeDebug {
  agentPos(id: string): { x: number; y: number } | null
  agentCount(): number
}
interface FakeDebug {
  commands: { type: string; [k: string]: unknown }[]
  emit(e: unknown): void
}

type Dbg = { __office: OfficeDebug; __scriptoriumFake: FakeDebug }

async function commands(page: Page) {
  return page.evaluate(() => (globalThis as unknown as Dbg).__scriptoriumFake.commands)
}

test('the office renders, an agent opens its terminal, and the controls send commands', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/?demo&seed=3&tick=0')

  // the canvas and all 17 starter agents
  const canvas = page.locator('.office-canvas canvas')
  await expect(canvas).toBeVisible()
  await expect.poll(() => page.evaluate(() => (globalThis as unknown as Dbg).__office?.agentCount() ?? 0), { timeout: 15_000 }).toBe(17)
  await expect(page.getByTestId('whiteboard')).toContainText('The Lantern and the Fox')
  await expect(page.getByTestId('meter-today')).toBeVisible()

  // states change as the fake engine works
  await expect(page.getByTestId('count-working')).not.toContainText('working 0', { timeout: 15_000 })

  // click an agent: its panel opens
  const id = 'writer-mara-quill'
  // wait until the agent has stopped walking
  const where = () => page.evaluate((agent) => JSON.stringify((globalThis as unknown as Dbg).__office.agentPos(agent)), id)
  let before = await where()
  await expect
    .poll(async () => {
      const now = await where()
      const same = now === before
      before = now
      return same
    })
    .toBe(true)
  const pos = await page.evaluate((agent) => (globalThis as unknown as Dbg).__office.agentPos(agent), id)
  expect(pos).not.toBeNull()
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + pos!.x, box.y + pos!.y)
  await expect(page.getByTestId('tooltip')).toContainText('Mara Quill')
  await page.mouse.click(box.x + pos!.x, box.y + pos!.y)
  await expect(page.getByTestId('agent-name')).toHaveText('Mara Quill')
  await expect(page.getByTestId('terminal')).toBeVisible()
  // history from the stubbed file reads
  await expect(page.getByTestId('terminal-log')).toContainText('Once upon a time')

  // streamed text shows up live
  await page.evaluate((agent) => {
    const { emit } = (globalThis as unknown as Dbg).__scriptoriumFake
    emit({ type: 'job.started', jobId: 'smoke-1', agent, task: 'draft ch-99', book: 'moon-bakery-bedtime', model: 'deepseek/deepseek-v4-flash' })
    emit({ type: 'job.token', jobId: 'smoke-1', agent, text: 'STREAMED-SMOKE-TEXT ' })
  }, id)
  await expect(page.getByTestId('terminal-log')).toContainText('STREAMED-SMOKE-TEXT')
  await page.evaluate((agent) => (globalThis as unknown as Dbg).__scriptoriumFake.emit({ type: 'job.token', jobId: 'smoke-1', agent, text: 'and more words' }), id)
  await expect(page.getByTestId('terminal-log')).toContainText('and more words')

  // the search box filters jobs
  await page.getByTestId('terminal-search').fill('STREAMED-SMOKE')
  await expect(page.getByTestId('job-block')).toHaveCount(1)
  await page.getByTestId('terminal-search').fill('')

  // the model picker sends setModel for this agent
  await page.getByTestId('agent-model').selectOption('lmstudio/nail-qwen3.6-35b-a3b-mtp')
  expect(await commands(page)).toContainEqual({ type: 'setModel', model: 'lmstudio/nail-qwen3.6-35b-a3b-mtp', agent: id })

  // and back to the role default
  await page.getByTestId('agent-model').selectOption('')
  expect(await commands(page)).toContainEqual({ type: 'setModel', model: null, agent: id })

  // pause the agent
  await page.getByTestId('agent-pause').click()
  expect(await commands(page)).toContainEqual({ type: 'pause', agent: id })

  // whiteboard highlight
  await page.getByTestId('book-moon-bakery-bedtime').click()
  await expect(page.getByTestId('book-moon-bakery-bedtime')).toHaveClass(/active/)

  // pause all
  await page.getByTestId('pause-all').click()
  expect((await commands(page)).some((c) => c.type === 'pauseAll')).toBe(true)
  await expect(page.getByTestId('pause-all')).toHaveText('Resume all')

  // stop now asks for confirmation inside the app
  await page.getByTestId('stop-now').click()
  await expect(page.getByTestId('stop-confirm')).toBeVisible()
  expect((await commands(page)).some((c) => c.type === 'stopNow')).toBe(false)
  await page.getByTestId('stop-confirm-yes').click()
  expect((await commands(page)).some((c) => c.type === 'stopNow')).toBe(true)

  // ask the researcher
  await page.getByTestId('ask-question').fill('How long did a ship take from Lisbon to Goa?')
  await page.getByTestId('ask-send').click()
  expect(await commands(page)).toContainEqual({ type: 'askResearcher', question: 'How long did a ship take from Lisbon to Goa?' })

  // hire
  await page.getByTestId('hire-open').click()
  await page.getByTestId('hire-role').selectOption('writer')
  await page.getByTestId('hire-name').fill('Nina Frost')
  await page.getByTestId('hire-submit').click()
  expect(await commands(page)).toContainEqual({ type: 'hire', role: 'writer', name: 'Nina Frost' })
  await expect.poll(() => page.evaluate(() => (globalThis as unknown as Dbg).__office.agentCount())).toBe(18)

  await page.screenshot({ path: '.claude/temp/p4-smoke-final.png' })
  expect(errors).toEqual([])
})

test('the library shows shelves, a book card opens, the reader shows chapter 1, and rating and settings send commands', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/?demo&seed=3&tick=0')
  await expect(page.getByTestId('whiteboard')).toBeVisible()

  await page.getByTestId('tab-library').click()
  await expect(page.getByTestId('library')).toBeVisible()
  // shelves: an active topic with books, an active topic with none (visible and empty), no shelf for an inactive empty topic
  await expect(page.getByTestId('shelf-jfic-bedtime-and-dreams')).toContainText("The Moon's Blanket")
  await expect(page.getByTestId('shelf-nf-history')).toContainText('Empty shelf')
  await expect(page.getByTestId('shelf-fic-sf')).toHaveCount(0)
  // the topic list switches topics on and off
  await page.getByTestId('topic-fic-sf').click()
  expect(await commands(page)).toContainEqual({ type: 'setTopicActive', id: 'fic-sf', active: true })
  await expect(page.getByTestId('shelf-fic-sf')).toContainText('Empty shelf')

  // the topic overview: grouped by section, the emptiest section first (a tie keeps the file order), counts per topic, and a filter
  const sections = page.locator('[data-testid^="topic-section-"]')
  await expect(sections).toHaveCount(4)
  expect(await sections.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))).toEqual(['topic-section-Non-fiction', 'topic-section-Law & Politics', 'topic-section-Fiction', 'topic-section-Children'])
  await expect(page.getByTestId('topic-summary')).toContainText('5 of 9 on')
  await expect(page.getByTestId('topic-jfic-bedtime-and-dreams')).toBeChecked()
  await expect(page.getByTestId('topic-count-jfic-bedtime-and-dreams')).toHaveText('2/5 +1')
  await expect(page.getByTestId('topic-count-nf-history')).toHaveText('0/3 +1')
  await expect(page.getByTestId('topic-law-civics')).toHaveCount(0) // the Law & Politics section has nothing on: closed
  await page.getByTestId('topic-filter').fill('printing')
  await expect(page.locator('.topic-row')).toHaveCount(1)
  await page.getByTestId('topic-nf-printing').click()
  expect(await commands(page)).toContainEqual({ type: 'setTopicActive', id: 'nf-printing', active: true })
  await expect(page.getByTestId('shelf-nf-printing')).toContainText('Empty shelf')
  await page.getByTestId('topic-filter').fill('')
  await page.getByTestId('topic-active-only').check()
  await expect(page.getByTestId('topic-nf-printing')).toBeChecked()
  await expect(page.getByTestId('topic-fic-historical')).toHaveCount(0)
  await page.getByTestId('topic-active-only').uncheck()
  // rejected books are kept apart
  await expect(page.getByTestId('library').locator('.shelf-title', { hasText: 'The Grey Lighthouse' })).toHaveCount(0)
  await page.getByTestId('toggle-rejected').click()
  await expect(page.getByTestId('library').locator('.shelf-title', { hasText: 'The Grey Lighthouse' })).toHaveCount(1)

  // the card
  await page.getByTestId('shelf-book-the-moons-blanket').click()
  await expect(page.getByTestId('card-title')).toHaveText("The Moon's Blanket")
  await expect(page.getByTestId('book-card')).toContainText('Mara Quill')
  await expect(page.getByTestId('book-card')).toContainText('Bedtime & Dreams')

  // the reader, in a sandboxed frame
  await page.getByTestId('card-read').click()
  const frame = page.getByTestId('reader-frame')
  await expect(frame).toHaveAttribute('sandbox', '')
  await expect(page.frameLocator('[data-testid=reader-frame]').getByRole('heading', { name: 'Chapter 1' })).toBeVisible()
  await page.getByTestId('reader-back').click()

  // rate it
  await page.getByTestId('rate-5').click()
  await page.getByTestId('rate-note').fill('Read it to my daughter.')
  await page.getByTestId('rate-save').click()
  expect(await commands(page)).toContainEqual({ type: 'rate', book: 'the-moons-blanket', rating: 5, note: 'Read it to my daughter.' })
  await expect(page.getByTestId('card-rating')).toHaveText('★★★★★')

  // Send to Kindle shows the result of kindle.sent
  await page.getByTestId('card-kindle').click()
  expect(await commands(page)).toContainEqual({ type: 'sendToKindle', book: 'the-moons-blanket' })
  await expect(page.getByTestId('kindle-status')).toHaveText('Sent.')
  await page.getByTestId('card-close').click()

  // settings: the password is sent as a secret and never shown again
  await page.getByTestId('settings-open').click()
  await expect(page.getByTestId('set-kindleAddress')).toHaveValue('me@kindle.com')
  await page.getByTestId('set-kindleAddress').fill('reader@kindle.com')
  await page.getByTestId('set-password').fill('s3cret-pass')
  await page.getByTestId('settings-save').click()
  const cmds = await commands(page)
  expect(cmds).toContainEqual(expect.objectContaining({ type: 'saveSettings', kindleAddress: 'reader@kindle.com', smtpHost: 'smtp.example.com' }))
  expect(cmds).toContainEqual({ type: 'setSecret', name: 'SCRIPTORIUM_SMTP_PASSWORD', value: 's3cret-pass' })
  expect(JSON.stringify(cmds.filter((c) => c.type === 'saveSettings'))).not.toContain('s3cret-pass')
  await page.getByTestId('settings-open').click()
  await expect(page.getByTestId('set-password')).toHaveValue('')
  await page.getByTestId('settings-close').click()

  // the idea bucket
  await page.getByTestId('idea-text').fill('A book about a clockwork heron')
  await page.getByTestId('idea-add').click()
  expect(await commands(page)).toContainEqual({ type: 'addIdea', text: 'A book about a clockwork heron' })

  expect(errors).toEqual([])
})
