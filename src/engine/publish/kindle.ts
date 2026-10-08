import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'

export interface MailSettings {
  kindleAddress: string
  fromAddress: string
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpSecure: boolean
}

export type TransportFactory = (settings: MailSettings, password: string | undefined) => Transporter

export const smtpTransport: TransportFactory = (s, password) =>
  nodemailer.createTransport({
    host: s.smtpHost,
    port: s.smtpPort,
    secure: s.smtpSecure,
    auth: s.smtpUser ? { user: s.smtpUser, pass: password ?? '' } : undefined
  })

/** Mails the EPUB to the Kindle address. Throws a short error that never contains the password. */
export async function sendEpub(transport: Transporter, s: MailSettings, book: { title: string; author: string; slug: string; epubPath: string }): Promise<void> {
  await transport.sendMail({
    from: s.fromAddress,
    to: s.kindleAddress,
    subject: book.title,
    text: `"${book.title}" by ${book.author}, sent from Scriptorium.`,
    attachments: [{ filename: `${book.slug}.epub`, path: book.epubPath, contentType: 'application/epub+zip' }]
  })
}
