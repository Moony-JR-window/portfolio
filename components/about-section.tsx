'use client'

import Image from 'next/image'
import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Reveal } from '@/components/reveal'
import { SkillBar } from '@/components/skill-bar'
import {
  aboutByYear,
  frameworkSkills,
  profile,
  toolSkills,
} from '@/lib/portfolio-data'

function BlurReveal({ value, copyable = true }: { value: string; copyable?: boolean }) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

  function copy(e: React.MouseEvent) {
    e.stopPropagation()
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        className={`blur-field ${revealed ? 'revealed' : ''} text-left text-foreground`}
        aria-label={revealed ? 'Hide' : 'Click to reveal'}
      >
        {value}
      </button>
      {copyable && revealed && (
        <button
          type="button"
          onClick={copy}
          aria-label="Copy to clipboard"
          className="text-primary transition-colors hover:opacity-70"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      )}
    </span>
  )
}

type Year = 2025 | 2026

export function AboutSection() {
  const [year, setYear] = useState<Year>(2025)
  const [swap, setSwap] = useState<'in' | 'out'>('in')
  const data = aboutByYear[year]

  function toggleYear() {
    setSwap('out')
    setTimeout(() => {
      setYear((y) => (y === 2025 ? 2026 : 2025))
      setSwap('in')
    }, 250)
  }

  return (
    <section id="about" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <Reveal className="mb-12">
        <h2 className="font-heading text-3xl font-extrabold sm:text-4xl">About</h2>
        <div className="mt-2 h-1 w-16 rounded-full bg-primary" />
      </Reveal>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Left column: profile + about text */}
        <div className="flex flex-col gap-8">
          <Reveal className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex flex-col gap-6 sm:flex-row">
              <div className="relative h-40 w-40 shrink-0 overflow-hidden rounded-2xl">
                <Image
                  src="/portfolio/about.jpg"
                  alt="Rorn Mony portrait"
                  fill
                  sizes="160px"
                  className="object-cover"
                />
              </div>
              <dl className="grid flex-1 gap-2.5 text-sm">
                <div className="flex gap-2">
                  <dt className="font-semibold text-foreground">Name:</dt>
                  <dd className="text-muted-foreground">{profile.name}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="font-semibold text-foreground">Profile:</dt>
                  <dd className="text-muted-foreground">{data.role}</dd>
                </div>
                <div className="flex flex-wrap gap-2">
                  <dt className="font-semibold text-foreground">Email:</dt>
                  <dd>
                    <BlurReveal value={profile.email} />
                  </dd>
                </div>
                <div className="flex flex-wrap gap-2">
                  <dt className="font-semibold text-foreground">Phone:</dt>
                  <dd>
                    <BlurReveal value={profile.phone} />
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="font-semibold text-foreground">LinkedIn:</dt>
                  <dd>
                    <a
                      href={profile.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      {profile.linkedinLabel}
                    </a>
                  </dd>
                </div>
              </dl>
            </div>
          </Reveal>

          <Reveal className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h3 className="font-heading text-xl font-bold">About me</h3>
              <button
                type="button"
                onClick={toggleYear}
                title="Click to change year"
                className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-sm font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
              >
                {year}
              </button>
            </div>
            <div
              className={`slide-swap space-y-3 text-pretty leading-relaxed text-muted-foreground ${
                swap === 'out' ? 'slide-out-left' : ''
              }`}
            >
              {data.text.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </Reveal>
        </div>

        {/* Right column: skills */}
        <div className="flex flex-col gap-8">
          <Reveal className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h3 className="mb-5 font-heading text-xl font-bold">Framework Skills</h3>
            <div className="space-y-4">
              {frameworkSkills.map((s) => (
                <SkillBar key={s.name} name={s.name} value={s.value} />
              ))}
            </div>
          </Reveal>

          <Reveal className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h3 className="mb-5 font-heading text-xl font-bold">Tools</h3>
            <div className="space-y-4">
              {toolSkills.map((s) => (
                <SkillBar key={s.name} name={s.name} value={s.value} />
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
