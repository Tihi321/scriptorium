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

  // the canvas and all 28 starter agents
  const canvas = page.locator('.office-canvas canvas')
  await expect(canvas).toBeVisible()
  await expect.poll(() => page.evaluate(() => (globalThis as unknown as Dbg).__office?.agentCount() ?? 0), { timeout: 15_000 }).toBe(28)
  await expect(page.getByTestId('whiteboard')).toContainText('The Lantern and the Fox')
  // the budget, the researcher box, the idea bucket and the role defaults are tabs, closed at first
  await expect(page.getByTestId('meter-today')).toHaveCount(0)
  await page.getByTestId('tool-budget').click()
  await expect(page.getByTestId('meter-today')).toBeVisible()
  // Strata is off in the demo: "Check now" asks the engine, which finds it running
  await expect(page.getByTestId('mcp-status')).toHaveText('MCP :7341')
  await expect(page.getByTestId('server-strata')).toHaveAttribute('data-down', 'true')
  await page.getByTestId('servers-check').click()
  await expect(page.getByTestId('server-strata')).toHaveAttribute('data-down', 'false')
  await expect(page.getByTestId('servers-check')).toHaveCount(0)

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
  // a failed request shows why, until a request is answered again
  await expect(page.getByTestId('agent-problem')).toHaveCount(0)
  await page.evaluate((agent) => {
    const problem = { kind: 'day-limit', model: 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free', message: 'HTTP 429: Rate limit exceeded: free-models-per-day', at: Date.now() }
    ;(globalThis as unknown as { __scriptoriumFake: { emit: (e: unknown) => void } }).__scriptoriumFake.emit({ type: 'agent.problem', agent, problem })
  }, id)
  await expect(page.getByTestId('agent-problem')).toContainText('Requests for today used up')
  await expect(page.getByTestId('agent-problem')).toContainText('Pick another model below')
  await page.getByTestId('agent-panel').screenshot({ path: '.claude/temp/agent-problem.png' })
  await page.evaluate((agent) => {
    ;(globalThis as unknown as { __scriptoriumFake: { emit: (e: unknown) => void } }).__scriptoriumFake.emit({ type: 'agent.problem', agent, problem: null })
  }, id)
  await expect(page.getByTestId('agent-problem')).toHaveCount(0)
  await expect(page.getByTestId('terminal')).toBeVisible()
  // history from the stubbed file reads
  await expect(page.getByTestId('terminal-log')).toContainText('Once upon a time')

  // streamed text shows up live
  await page.evaluate((agent) => {
    const { emit } = (globalThis as unknown as Dbg).__scriptoriumFake
    emit({ type: 'job.started', jobId: 'smoke-1', agent, task: 'draft ch-99', book: 'moon-bakery-bedtime', model: 'deepseek/deepseek-flash' })
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

  // assign the agent to a book: the exclusive box appears only then, and sends the command with `exclusive`
  await expect(page.getByTestId('agent-book-exclusive')).toHaveCount(0)
  await page.getByTestId('agent-book').selectOption({ index: 1 })
  const assigned = (await commands(page)).find((c) => c.type === 'assignBook' && c.agent === id)!
  expect(assigned).toMatchObject({ book: expect.any(String), exclusive: false })
  await expect(page.getByTestId('agent-book-exclusive')).not.toBeChecked()
  await page.getByTestId('agent-book-exclusive').click()
  expect(await commands(page)).toContainEqual({ type: 'assignBook', agent: id, book: assigned.book, exclusive: true })
  await expect(page.getByTestId('agent-book-exclusive')).toBeChecked() // the fake engine answered with pinExclusive, and the store shows it
  await page.getByTestId('agent-book').selectOption('')
  await expect(page.getByTestId('agent-book-exclusive')).toHaveCount(0)

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
  await page.getByTestId('tool-ask').click()
  await page.getByTestId('ask-question').fill('How long did a ship take from Lisbon to Goa?')
  await page.getByTestId('ask-send').click()
  expect(await commands(page)).toContainEqual({ type: 'askResearcher', question: 'How long did a ship take from Lisbon to Goa?' })

  // hire
  await page.getByTestId('hire-open').click()
  await page.getByTestId('hire-role').selectOption('writer')
  await page.getByTestId('hire-name').fill('Nina Frost')
  await page.getByTestId('hire-submit').click()
  expect(await commands(page)).toContainEqual({ type: 'hire', role: 'writer', name: 'Nina Frost' })
  await expect.poll(() => page.evaluate(() => (globalThis as unknown as Dbg).__office.agentCount())).toBe(28)

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
  await expect(sections).toHaveCount(5)
  expect(await sections.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))).toEqual(['topic-section-Non-fiction', 'topic-section-Law & Politics', 'topic-section-Fiction', 'topic-section-Children', 'topic-section-Newspaper'])
  await expect(page.getByTestId('topic-summary')).toContainText('6 of 12 on')
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
  // your own topic: added from the panel, switched on, in the My topics section, with an empty shelf
  await page.getByTestId('topic-add-name').fill('Dragons Who Bake')
  await page.getByTestId('topic-add-kind').selectOption('juvenile-fiction')
  await page.getByTestId('topic-add-target').fill('3')
  await page.getByTestId('topic-add-button').click()
  expect(await commands(page)).toContainEqual({ type: 'addTopic', name: 'Dragons Who Bake', kind: 'juvenile-fiction', target: 3 })
  await expect(page.getByTestId('topic-section-My topics')).toBeVisible()
  await expect(page.getByTestId('topic-my-dragons-who-bake')).toBeChecked()
  await expect(page.getByTestId('topic-count-my-dragons-who-bake')).toHaveText('0/3')
  await expect(page.getByTestId('topic-add-name')).toHaveValue('')
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
  // turn the pages: the arrows, the arrow keys and the page list
  await expect(page.getByTestId('reader-prev')).toBeDisabled()
  await page.getByTestId('reader-next').click()
  await expect(page.getByTestId('reader-page')).toHaveValue('chapter-01.xhtml')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('reader-page')).toHaveValue('chapter-02.xhtml')
  await expect(page.frameLocator('[data-testid=reader-frame]').getByRole('heading', { name: 'Chapter 2' })).toBeVisible()
  await expect(page.getByTestId('reader-next')).toBeDisabled()
  await page.getByTestId('reader-page').selectOption('index.html')
  await expect(page.getByTestId('reader-prev')).toBeDisabled()
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
  // Close saves a change too, and only when something changed
  const saves = async () => (await commands(page)).filter((c) => c.type === 'saveSettings').length
  const before = await saves()
  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-close').click()
  expect(await saves()).toBe(before)
  await page.getByTestId('settings-open').click()
  await page.getByTestId('set-maxBooksInProgress').fill('4')
  await page.getByTestId('settings-close').click()
  expect(await commands(page)).toContainEqual(expect.objectContaining({ type: 'saveSettings', maxBooksInProgress: 4 }))

  // the Models panel: the alias defaults, a provider lists its models on Detect, ticking one shows it in the pickers,
  // a model without a price can't be ticked, a model can be added by its id, and LM Studio's load settings
  await page.getByTestId('settings-open').click()
  await expect(page.getByTestId('fallback-add')).toHaveCount(0) // the fallback list is in the Models panel
  await page.getByTestId('settings-close').click()
  await page.getByTestId('models-open').click()
  await expect(page.getByTestId('models-dialog')).toBeVisible()
  const lastSave = async () => (await commands(page)).filter((c) => c.type === 'saveSettings').at(-1) as unknown as { fallbacks: string[]; fallbackShared: boolean; kindleAddress: string }
  // the fallback list: one row per model, each answering to its kind's alias
  await expect(page.locator('[data-testid^="fallback-row-"]')).toHaveCount(3)
  await expect(page.getByTestId('fallback-alias-0')).toHaveText('paid')
  await expect(page.getByTestId('fallback-alias-1')).toHaveText('strata')
  await expect(page.getByTestId('fallback-alias-2')).toHaveText('lmstudio')
  await expect(page.getByTestId('fallback-kind-0')).toHaveValue('paid')
  await page.getByTestId('fallback-model-0').selectOption('openrouter/google/gemma-4-31b-it:free')
  expect((await lastSave()).fallbacks[0]).toBe('openrouter/google/gemma-4-31b-it:free')
  expect((await lastSave()).kindleAddress).toBe('reader@kindle.com')
  await expect(page.getByTestId('fallback-model-0')).toHaveValue('openrouter/google/gemma-4-31b-it:free')
  // add a row (an API model), turn it into an LM Studio row, move it up and remove it
  await page.getByTestId('fallback-add').click()
  await expect(page.locator('[data-testid^="fallback-row-"]')).toHaveCount(4)
  expect((await lastSave()).fallbacks).toHaveLength(4)
  await expect(page.getByTestId('fallback-alias-3')).toHaveText('paid-2')
  await page.getByTestId('fallback-kind-3').selectOption('lmstudio')
  await expect(page.getByTestId('fallback-alias-3')).toHaveText('lmstudio-2')
  const four = (await lastSave()).fallbacks
  expect(four[3]).toMatch(/^lmstudio\//)
  await page.getByTestId('fallback-up-3').click()
  await expect(page.getByTestId('fallback-model-2')).toHaveValue(four[3]!)
  expect((await lastSave()).fallbacks).toEqual([four[0], four[1], four[3], four[2]])
  await page.getByTestId('fallback-remove-2').click()
  await expect(page.locator('[data-testid^="fallback-row-"]')).toHaveCount(3)
  expect((await lastSave()).fallbacks).toEqual([four[0], four[1], four[2]])
  // one fallback order for every role: ticking turns it on, unticking goes back to each role's own order
  await expect(page.getByTestId('order-shared')).not.toBeChecked()
  await page.getByTestId('order-shared').click() // follows the engine's snapshot, so not check()
  expect((await lastSave()).fallbackShared).toBe(true)
  await expect(page.getByTestId('order-shared')).toBeChecked()
  await page.getByTestId('order-shared').click()
  expect((await lastSave()).fallbackShared).toBe(false)
  await expect(page.getByTestId('order-shared')).not.toBeChecked()
  await page.getByTestId('models-provider-openrouter').click()
  expect(await commands(page)).not.toContainEqual({ type: 'detectModels', provider: 'openrouter' }) // only on the button
  await page.getByTestId('models-detect').click()
  expect(await commands(page)).toContainEqual({ type: 'detectModels', provider: 'openrouter' })
  const gpt = page.getByTestId('model-row-openrouter/openai/gpt-6')
  await expect(gpt).toContainText('$3 / $15')
  await expect(page.getByTestId('model-row-openrouter/google/gemma-4-31b-it:free')).toContainText('free')
  await page.getByTestId('models-free').check()
  await expect(gpt).toHaveCount(0)
  await page.getByTestId('models-free').uncheck()
  await gpt.locator('input').click() // the box follows the engine's answer, not the click
  expect(await commands(page)).toContainEqual({ type: 'showModels', refs: ['openrouter/openai/gpt-6'], shown: true })
  await expect(gpt).toContainText('added')
  await expect(gpt.locator('input')).toBeChecked()
  // add by id: a paid provider needs both prices
  await page.getByTestId('models-add-id').fill('qwen/qwen3-235b-a22b:free')
  await expect(page.getByTestId('models-add')).toBeDisabled()
  await page.getByTestId('models-add-in').fill('0')
  await page.getByTestId('models-add-out').fill('0')
  await page.getByTestId('models-add').click()
  expect(await commands(page)).toContainEqual({ type: 'addModel', provider: 'openrouter', id: 'qwen/qwen3-235b-a22b:free', priceIn: 0, priceOut: 0, context: undefined })
  await expect(page.getByTestId('model-row-openrouter/qwen/qwen3-235b-a22b:free').locator('input')).toBeChecked()
  // the provider's limits: requests at once, per minute and per day, and today's count against the daily limit
  await expect(page.getByTestId('limit-rpm')).toHaveValue('20')
  await expect(page.getByTestId('provider-today')).toContainText('37 of 50')
  await page.getByTestId('limit-rpd').fill('30')
  await page.getByTestId('limit-rpd').press('Enter')
  expect(await commands(page)).toContainEqual({ type: 'setProviderLimits', provider: 'openrouter', rpd: 30 })
  await expect(page.getByTestId('provider-today')).toContainText('Used up today')
  await page.getByTestId('limit-rpm').fill('')
  await page.getByTestId('limit-rpm').blur()
  expect(await commands(page)).toContainEqual({ type: 'setProviderLimits', provider: 'openrouter', rpm: 0 })
  await page.getByTestId('models-provider-deepseek').click()
  await page.getByTestId('models-detect').click()
  await expect(page.getByTestId('model-row-deepseek/deepseek-chat').locator('input')).toBeDisabled()
  await page.getByTestId('models-provider-anthropic').click()
  await expect(page.getByTestId('models-status')).toContainText('No key')
  await expect(page.getByTestId('models-detect')).toBeDisabled()
  await page.getByTestId('models-provider-lmstudio').click()
  await expect(page.getByTestId('models-add-in')).toHaveCount(0) // local: no price
  await expect(page.getByTestId('provider-limits')).toHaveCount(0) // a local server sets its own requests at once
  await page.getByTestId('set-lmstudioParallel').fill('2')
  await page.getByTestId('models-close').click()
  expect(await commands(page)).toContainEqual(expect.objectContaining({ type: 'saveSettings', lmstudioParallel: 2 }))
  await expect(page.getByTestId('models-dialog')).toHaveCount(0)

  // the idea bucket
  await page.getByTestId('tool-idea').click()
  await page.getByTestId('idea-text').fill('A book about a clockwork heron')
  await page.getByTestId('idea-add').click()
  expect(await commands(page)).toContainEqual({ type: 'addIdea', text: 'A book about a clockwork heron' })

  // a described story: two characters and a section of its own, then it waits in the list and can be edited
  await expect(page.getByTestId('story-form')).toHaveCount(0)
  await page.getByTestId('story-describe').click()
  await expect(page.getByTestId('story-save')).toBeDisabled()
  await page.getByTestId('story-title').fill('The Lantern Keeper')
  await page.getByTestId('story-format').selectOption('novella')
  await page.getByTestId('story-genre').fill('Sea adventure')
  await page.getByTestId('story-premise').fill('A girl keeps a lighthouse.')
  await page.getByTestId('story-add-character').click()
  await page.getByTestId('story-add-character').click()
  await page.getByTestId('story-char-name').nth(0).fill('Mara Quill')
  await page.getByTestId('story-char-role').nth(0).fill('the hero')
  await page.getByTestId('story-char-desc').nth(0).fill('Freckled.')
  await page.getByTestId('story-char-name').nth(1).fill('Old Bram')
  await page.getByTestId('story-add-section').click()
  await page.getByTestId('story-section-heading').fill('Themes')
  await page.getByTestId('story-section-text').fill('Courage.')
  await page.getByTestId('story-save').click()
  expect(await commands(page)).toContainEqual({
    type: 'addStory',
    brief: {
      title: 'The Lantern Keeper',
      premise: 'A girl keeps a lighthouse.',
      plot: '',
      characters: [
        { name: 'Mara Quill', role: 'the hero', description: 'Freckled.' },
        { name: 'Old Bram', role: '', description: '' }
      ],
      setting: '',
      style: '',
      sections: [{ heading: 'Themes', text: 'Courage.' }],
      format: 'novella',
      genre: 'Sea adventure'
    }
  })
  await expect(page.getByTestId('story-form')).toHaveCount(0)
  await expect(page.getByTestId('waiting-story')).toHaveCount(1)
  await expect(page.getByTestId('waiting-story')).toContainText('The Lantern Keeper')
  await expect(page.getByTestId('waiting-story')).toContainText('2 characters')
  await page.getByTestId('waiting-story').click()
  await expect(page.getByTestId('story-title')).toHaveValue('The Lantern Keeper')
  await expect(page.getByTestId('story-character')).toHaveCount(2)
  await expect(page.getByTestId('story-char-name').nth(1)).toHaveValue('Old Bram')
  await page.getByTestId('story-char-remove').nth(1).click()
  await page.getByTestId('story-title').fill('The Lamp Keeper')
  await page.getByTestId('story-save').click()
  expect(await commands(page)).toContainEqual(expect.objectContaining({ type: 'updateStory', idea: 'the-lantern-keeper', brief: expect.objectContaining({ title: 'The Lamp Keeper', characters: [{ name: 'Mara Quill', role: 'the hero', description: 'Freckled.' }] }) }))
  await expect(page.getByTestId('waiting-story')).toContainText('The Lamp Keeper')

  expect(errors).toEqual([])
})
