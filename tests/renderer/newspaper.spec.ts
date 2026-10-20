import { expect, test, type Page } from '@playwright/test'

interface FakeDebug {
  commands: { type: string; [k: string]: unknown }[]
}

async function commands(page: Page) {
  return page.evaluate(() => (globalThis as unknown as { __scriptoriumFake: FakeDebug }).__scriptoriumFake.commands)
}

test('the Newspaper tab shows the front page by day and section, opens an article, and writes a new one', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/?demo&seed=3&tick=0')
  await expect(page.getByTestId('whiteboard')).toBeVisible()
  await expect(page.getByTestId('newspaper')).toHaveCount(0)
  await page.getByTestId('tab-newspaper').click()
  await expect(page.getByTestId('newspaper')).toBeVisible()

  // the front page: two days, newest first; the sections inside a day; headline, standfirst and byline of each article
  await expect(page.getByTestId('newspaper-count')).toContainText('3 published, 0 in progress')
  const days = await page.locator('[data-testid^="day-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
  expect(days).toEqual(['day-2026-10-19', 'day-2026-10-18'])
  await expect(page.getByTestId('section-2026-10-19-Technology')).toContainText('Chipmakers race to power the grid')
  await expect(page.getByTestId('section-2026-10-19-Science')).toContainText('Seismologists find a quiet fault under the Alps')
  await expect(page.getByTestId('section-2026-10-18-Technology')).toContainText('Libraries try robot shelvers')
  const chips = page.getByTestId('article-chips-for-the-grid')
  await expect(chips).toContainText('Three firms say their new power chips cut data centre energy use by a fifth.')
  await expect(chips).toContainText('By Mara Quill')

  // books never show on the front page, and articles never show on the Library shelves
  await expect(page.getByTestId('article-hedgehog-hospital')).toHaveCount(0)
  await page.getByTestId('tab-library').click()
  await expect(page.getByTestId('shelf-book-hedgehog-hospital')).toBeVisible()
  await expect(page.getByTestId('shelf-book-chips-for-the-grid')).toHaveCount(0)
  await expect(page.getByTestId('shelf-news-technology')).toHaveCount(0)
  await page.getByTestId('tab-newspaper').click()

  // a click opens the article page, in a frame; it closes again
  await page.getByTestId('article-chips-for-the-grid').click()
  await expect(page.getByTestId('article-viewer')).toBeVisible()
  await expect(page.getByTestId('article-frame')).toBeVisible()
  await page.getByTestId('article-close').click()
  await expect(page.getByTestId('article-viewer')).toHaveCount(0)

  // an article's card has no cover tools, no Kindle, no adaptation
  await page.getByTestId('article-chips-for-the-grid').click()
  await page.getByTestId('article-card').click()
  await expect(page.getByTestId('book-card')).toBeVisible()
  await expect(page.getByTestId('card-read')).toHaveText('Open article')
  await expect(page.getByTestId('card-kindle')).toHaveCount(0)
  await expect(page.getByTestId('card-cover')).toHaveCount(0)
  await expect(page.getByTestId('card-adapt')).toHaveCount(0)
  await page.getByTestId('card-close').click()
  await expect(page.getByTestId('newspaper')).toBeVisible()

  // the form: sections are the topics of kind article, the button waits for a subject
  const sections = await page.getByTestId('article-section').locator('option').allTextContents()
  expect(sections).toEqual(['Technology', 'Science', 'World'])
  await expect(page.getByTestId('article-section')).toHaveValue('news-technology') // the first active section
  await expect(page.getByTestId('article-submit')).toBeDisabled()
  await page.getByTestId('article-section').selectOption('news-science')
  await page.getByTestId('article-subject').fill('The new EU rules on AI')
  await page.getByTestId('article-angle').fill('What changes for small companies')
  await page.getByTestId('article-format').selectOption('feature-article')
  await page.getByTestId('article-submit').click()
  const sent = (await commands(page)).filter((c) => c.type === 'addStory')
  expect(sent).toHaveLength(1)
  expect(sent[0]!.brief).toMatchObject({
    premise: 'The new EU rules on AI',
    sections: [{ heading: 'Angle', text: 'What changes for small companies' }],
    format: 'feature-article',
    topic: 'news-science'
  })
  await expect(page.getByTestId('article-status')).toContainText('Sent')
  await expect(page.getByTestId('article-subject')).toHaveValue('')

  // the article appears under "In progress" (compact), not on the front page
  await expect(page.getByTestId('newspaper-count')).toContainText('3 published, 1 in progress')
  await expect(page.getByTestId('articles-in-progress')).toContainText('outline')
  await expect(page.locator('[data-testid^="working-"]')).toHaveCount(1)

  // the angle is optional
  await page.getByTestId('article-subject').fill('A strike at the port')
  await page.getByTestId('article-submit').click()
  const again = (await commands(page)).filter((c) => c.type === 'addStory')
  expect(again).toHaveLength(2)
  expect(again[1]!.brief).toMatchObject({ premise: 'A strike at the port', sections: [], format: 'feature-article', topic: 'news-science' })
  expect(errors).toEqual([])
})
