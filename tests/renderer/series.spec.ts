import { expect, test, type Page } from '@playwright/test'

interface FakeDebug {
  commands: { type: string; [k: string]: unknown }[]
}

async function commands(page: Page) {
  return page.evaluate(() => (globalThis as unknown as { __scriptoriumFake: FakeDebug }).__scriptoriumFake.commands)
}

test('the library creates a series, and "Next book" opens the story form with the series selected', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/?demo&seed=3&tick=0')
  await expect(page.getByTestId('whiteboard')).toBeVisible()
  await page.getByTestId('tab-library').click()
  await expect(page.getByTestId('series-panel')).toBeVisible()
  await expect(page.getByTestId('series-panel')).toContainText('No series yet')

  // a new series: title, genre, premise, one recurring character, setting and style
  await expect(page.getByTestId('series-form')).toHaveCount(0)
  await page.getByTestId('series-new').click()
  await expect(page.getByTestId('series-save')).toBeDisabled()
  await page.getByTestId('series-title').fill('The Ninth Hour')
  await page.getByTestId('series-genre').fill('Comic mystery')
  await page.getByTestId('series-premise').fill('A fraternity hides behind Paris.')
  await page.getByTestId('series-add-character').click()
  await page.getByTestId('series-char-name').fill('Dec Hartley')
  await page.getByTestId('series-char-role').fill('locksmith')
  await page.getByTestId('series-setting').fill('Paris today')
  await page.getByTestId('series-style').fill('Comic')
  await page.getByTestId('series-save').click()
  expect(await commands(page)).toContainEqual({
    type: 'addSeries',
    brief: {
      title: 'The Ninth Hour',
      genre: 'Comic mystery',
      premise: 'A fraternity hides behind Paris.',
      plot: '',
      characters: [{ name: 'Dec Hartley', role: 'locksmith', description: '' }],
      setting: 'Paris today',
      style: 'Comic',
      sections: []
    }
  })
  await expect(page.getByTestId('series-form')).toHaveCount(0)
  await expect(page.getByTestId('series-the-ninth-hour')).toBeVisible()
  await expect(page.getByTestId('series-title-the-ninth-hour')).toHaveText('The Ninth Hour')
  await expect(page.getByTestId('series-books-the-ninth-hour')).toHaveCount(0) // no book yet

  // "Next book": the Ideas tab opens with the story form and the series selected
  await page.getByTestId('series-next-the-ninth-hour').click()
  await expect(page.getByTestId('story-form')).toBeVisible()
  await expect(page.getByTestId('story-series')).toHaveValue('the-ninth-hour')
  await page.getByTestId('story-title').fill('The Clockmaker Street Job')
  await page.getByTestId('story-premise').fill('Dec opens the wrong door.')
  await page.getByTestId('story-save').click()
  expect(await commands(page)).toContainEqual(
    expect.objectContaining({ type: 'addStory', brief: expect.objectContaining({ title: 'The Clockmaker Street Job', series: 'the-ninth-hour' }) })
  )

  // the series lists the new book first, still waiting for its turn
  await expect(page.getByTestId('series-books-the-ninth-hour')).toContainText('The Clockmaker Street Job')
  await expect(page.getByTestId('series-book-stage-the-clockmaker-street-job')).toHaveText('waiting')

  // a second "Next book" gives book 2, and the story form has the series chosen again
  await page.getByTestId('series-next-the-ninth-hour').click()
  await expect(page.getByTestId('story-series')).toHaveValue('the-ninth-hour')
  await page.getByTestId('story-title').fill('The Stopped Hour')
  await page.getByTestId('story-save').click()
  await expect(page.getByTestId('series-books-the-ninth-hour').locator('li')).toHaveCount(2)
  await expect(page.getByTestId('series-books-the-ninth-hour').locator('li').nth(1)).toContainText('The Stopped Hour')

  // the series can be edited, and a story can be put in a series by hand with the select
  await page.getByTestId('series-edit-the-ninth-hour').click()
  await expect(page.getByTestId('series-title')).toHaveValue('The Ninth Hour')
  await expect(page.getByTestId('series-char-name')).toHaveValue('Dec Hartley')
  await page.getByTestId('series-premise').fill('The arc, version two.')
  await page.getByTestId('series-save').click()
  expect(await commands(page)).toContainEqual(expect.objectContaining({ type: 'updateSeries', series: 'the-ninth-hour', brief: expect.objectContaining({ premise: 'The arc, version two.' }) }))
  await page.getByTestId('tool-idea').click() // closes the tab
  await page.getByTestId('tool-idea').click()
  await page.getByTestId('story-describe').click()
  await expect(page.getByTestId('story-series')).toHaveValue('')
  await page.getByTestId('story-series').selectOption('the-ninth-hour')
  await expect(page.getByTestId('story-series')).toHaveValue('the-ninth-hour')

  expect(errors).toEqual([])
})
