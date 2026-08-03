'use client'

import { useState } from 'react'
import { Send } from 'lucide-react'
import { Reveal } from '@/components/reveal'

type Mode = 'contact' | 'anonymous'
type Status = { type: 'success' | 'error'; text: string } | null

export function ContactSection() {
  const [mode, setMode] = useState<Mode>('contact')
  const [username, setUsername] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const anonymous = mode === 'anonymous'

  function changeMode(next: Mode) {
    setMode(next)
    setStatus(null)
    if (next === 'anonymous') {
      setUsername('anonymous@gmail.com')
      setSubject('Anonymous Subject')
    } else {
      setUsername('')
      setSubject('')
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSending(true)
    setStatus(null)
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, subject, message }),
      })
      const data = await res.json()
      if (res.ok && data.status === 200) {
        setStatus({ type: 'success', text: 'Message sent successfully!' })
        setMessage('')
        if (!anonymous) {
          setUsername('')
          setSubject('')
        }
      } else {
        setStatus({ type: 'error', text: data.error || 'Something went wrong.' })
      }
    } catch (err) {
      setStatus({
        type: 'error',
        text: err instanceof Error ? err.message : 'Network error.',
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <section id="contact" className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
      <Reveal className="mb-10 text-center">
        <h2 className="font-heading text-3xl font-extrabold sm:text-4xl">Get In Touch</h2>
        <div className="mx-auto mt-2 h-1 w-16 rounded-full bg-primary" />
        <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
          Have a question or want to work together? Send me a message.
        </p>
      </Reveal>

      <Reveal className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex justify-center gap-2 rounded-full bg-secondary p-1">
          {(['contact', 'anonymous'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => changeMode(m)}
              className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold capitalize transition-colors ${
                mode === m
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {m === 'contact' ? 'Contact Me' : 'Anonymous'}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="mb-1.5 block text-sm font-semibold">
              Email
            </label>
            <input
              id="username"
              type="email"
              required
              disabled={anonymous}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
            />
          </div>

          <div>
            <label htmlFor="subject" className="mb-1.5 block text-sm font-semibold">
              Subject
            </label>
            <input
              id="subject"
              type="text"
              required
              disabled={anonymous}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Enter subject"
              className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
            />
          </div>

          <div>
            <label htmlFor="message" className="mb-1.5 block text-sm font-semibold">
              Message
            </label>
            <textarea
              id="message"
              required
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Enter your message"
              className="w-full resize-y rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <button
            type="submit"
            disabled={sending}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <Send className="h-4 w-4" />
            {sending ? 'Sending...' : 'Send Message'}
          </button>

          {status && (
            <p
              role="status"
              className={`rounded-lg px-4 py-2.5 text-center text-sm font-medium ${
                status.type === 'success'
                  ? 'bg-primary/10 text-primary'
                  : 'bg-destructive/10 text-destructive'
              }`}
            >
              {status.text}
            </p>
          )}
        </form>
      </Reveal>
    </section>
  )
}
