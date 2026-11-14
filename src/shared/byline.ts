/**
 * SCP-60: who a book shows as its author. `byline` (book.md) is the name the owner gives the book; `author` is the writer agent's pen name
 * (set by the engine). The cover, the EPUB metadata and title page, the reader, the PDF and the other readers of book.md show the byline when
 * there is one, else the pen name (today's behaviour). The agent's name stays in the credits line ("Written by an AI writer ...").
 */
export function displayAuthor(data: { byline?: unknown; author?: unknown }): string | null {
  const byline = typeof data.byline === 'string' ? data.byline.trim() : ''
  if (byline) return byline
  return typeof data.author === 'string' && data.author.trim() ? data.author : null
}
