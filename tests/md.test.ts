import { describe, expect, it } from 'vitest'
import { MdValidationError, parseMd, parseMdWith, serializeMd, splitFrontmatter } from '../src/shared/md'
import { budgetSchema } from '../src/shared/schemas'

describe('md round trip', () => {
  const data = { kind: 'demo', title: 'The Silver Inn', tags: ['a', 'b'], n: 3, nested: { ok: true } }
  const body = '\n# Heading\n\nSome text with --- dashes\n---\nand a rule above.\n\n  indented\ttab  \nlast line no newline'

  it('keeps data and body exactly', () => {
    const text = serializeMd(data, body)
    const doc = parseMd(text)
    expect(doc.data).toEqual(data)
    expect(doc.body).toBe(body)
    expect(serializeMd(doc.data, doc.body)).toBe(text)
  })

  it('handles an empty body and empty data', () => {
    expect(parseMd(serializeMd({}, ''))).toEqual({ data: {}, body: '' })
    expect(parseMd(serializeMd({ a: 1 }, ''))).toEqual({ data: { a: 1 }, body: '' })
  })

  it('treats a file without frontmatter as all body', () => {
    expect(parseMd('# Just text\n')).toEqual({ data: {}, body: '# Just text\n' })
  })

  it('tolerates CRLF input and a BOM', () => {
    const text = '﻿---\r\nkind: demo\r\ntitle: Hi\r\n---\r\nBody line 1\r\nBody line 2\r\n'
    const doc = parseMd(text)
    expect(doc.data).toEqual({ kind: 'demo', title: 'Hi' })
    expect(doc.body).toBe('Body line 1\r\nBody line 2\r\n')
  })

  it('does not mistake a body rule for a closing delimiter', () => {
    const { frontmatter, body: b } = splitFrontmatter('---\na: 1\n---\ntext\n---\nmore\n')
    expect(frontmatter).toBe('a: 1\n')
    expect(b).toBe('text\n---\nmore\n')
  })
})

describe('zod validation', () => {
  it('accepts a valid budget file and fills defaults', () => {
    const doc = parseMdWith(serializeMd({ kind: 'budget', monthly_cap_usd: 40, daily_cap_usd: 5 }, 'x'), budgetSchema)
    expect(doc.data.warn_at).toBe(0.8)
    expect(doc.data.per_book_cap_usd).toBeNull()
  })

  it('throws a readable error naming the file and field', () => {
    const text = serializeMd({ kind: 'budget', monthly_cap_usd: 'forty', daily_cap_usd: 5 })
    expect(() => parseMdWith(text, budgetSchema, 'config/budget.md')).toThrowError(MdValidationError)
    expect(() => parseMdWith(text, budgetSchema, 'config/budget.md')).toThrowError(/config\/budget\.md[\s\S]*monthly_cap_usd/)
  })
})
