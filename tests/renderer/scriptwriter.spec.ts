import { expect, test, type Page } from '@playwright/test'

interface FakeDebug {
  commands: { type: string; [k: string]: unknown }[]
}

async function commands(page: Page) {
  return page.evaluate(() => (globalThis as unknown as { __scriptoriumFake: FakeDebug }).__scriptoriumFake.commands)
}

test('a published book opens the Script writer, which adapts it into a visual novel or a screenplay', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/?demo&seed=3&tick=0')
  await expect(page.getByTestId('whiteboard')).toBeVisible()
  await page.getByTestId('tab-library').click()

  // a published book (the only ones on the shelves) has the button
  await page.getByTestId('shelf-book-hedgehog-hospital').click()
  await expect(page.getByTestId('card-adapt')).toBeVisible()
  await expect(page.getByTestId('script-writer')).toHaveCount(0)

  // the panel: linear is the default, choices has its own hint, the title and notes are optional
  await page.getByTestId('card-adapt').click()
  await expect(page.getByTestId('script-writer')).toBeVisible()
  await expect(page.getByTestId('adapt-format')).toHaveValue('visual-novel')
  await expect(page.getByTestId('adapt-format-hint')).toContainText('no choices')
  await page.getByTestId('adapt-format').selectOption('choice-visual-novel')
  await expect(page.getByTestId('adapt-format-hint')).toContainText('canon path')
  // a screenplay format is listed too, with its own hint
  await page.getByTestId('adapt-format').selectOption('short-film')
  await expect(page.getByTestId('adapt-format-hint')).toContainText('film')
  await page.getByTestId('adapt-format').selectOption('choice-visual-novel')
  await page.getByTestId('adapt-title').fill('Hedgehog Hospital, the Script')
  await page.getByTestId('adapt-notes').fill('Keep the night nurse.')
  await page.getByTestId('adapt-submit').click()
  expect(await commands(page)).toContainEqual({ type: 'adaptBook', book: 'hedgehog-hospital', format: 'choice-visual-novel', title: 'Hedgehog Hospital, the Script', notes: 'Keep the night nurse.' })
  await expect(page.getByTestId('adapt-status')).toContainText('Sent')
  await expect(page.getByTestId('adapt-submit')).toBeDisabled()

  // back to the card, and the new book says what it adapts (whiteboard info)
  await page.getByTestId('adapt-close').click()
  await expect(page.getByTestId('card-adapt')).toBeVisible()
  await page.getByTestId('card-close').click()
  await page.getByTestId('tab-office').click()
  await page.getByTestId('book-hedgehog-hospital-the-script').click()
  await expect(page.getByTestId('info-adapted-from')).toHaveText('Hedgehog Hospital')

  // linear, with nothing else filled in, sends only what was set
  await page.getByTestId('tab-library').click()
  await page.getByTestId('shelf-book-hedgehog-hospital').click()
  await page.getByTestId('card-adapt').click()
  await page.getByTestId('adapt-submit').click()
  expect(await commands(page)).toContainEqual({ type: 'adaptBook', book: 'hedgehog-hospital', format: 'visual-novel' })
  expect(errors).toEqual([])
})
