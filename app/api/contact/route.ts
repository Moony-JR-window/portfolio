import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  let body: { username?: string; subject?: string; message?: string }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const username = (body.username ?? '').trim()
  const subject = (body.subject ?? '').trim()
  const message = (body.message ?? '').trim()

  if (!username || !subject || !message) {
    return NextResponse.json(
      { error: 'All fields are required.' },
      { status: 400 },
    )
  }

  if (message.length > 5000) {
    return NextResponse.json({ error: 'Message is too long.' }, { status: 400 })
  }

  // In production, wire this up to email/DB. For now we log it server-side.
  console.log('[v0] Contact message received:', { username, subject })

  return NextResponse.json({ status: 200, message: 'Message sent successfully!' })
}
