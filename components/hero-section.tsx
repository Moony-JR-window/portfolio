'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { profile } from '@/lib/portfolio-data'

function useTyped(strings: string[]) {
  const [text, setText] = useState('')

  useEffect(() => {
    let index = 0
    let char = 0
    let deleting = false
    let timeout: ReturnType<typeof setTimeout>

    function tick() {
      const full = strings[index]
      if (!deleting) {
        char++
        setText(full.slice(0, char))
        if (char === full.length) {
          deleting = true
          timeout = setTimeout(tick, 1800)
          return
        }
        timeout = setTimeout(tick, 90)
      } else {
        char--
        setText(full.slice(0, char))
        if (char === 0) {
          deleting = false
          index = (index + 1) % strings.length
          timeout = setTimeout(tick, 400)
          return
        }
        timeout = setTimeout(tick, 45)
      }
    }

    timeout = setTimeout(tick, 500)
    return () => clearTimeout(timeout)
  }, [strings])

  return text
}

export function HeroSection() {
  const typed = useTyped(profile.roles)

  return (
    <section id="hero" className="relative flex min-h-[92vh] items-center overflow-hidden">
      <Image
        src="/portfolio/hero.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover object-[center_25%]"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/20 to-background" />
      <div className="absolute inset-0 bg-background/20" />

      <div className="relative mx-auto w-full max-w-6xl px-4 sm:px-6">
        {/* <p className="mb-3 text-xs font-medium uppercase tracking-[0.25em] text-primary sm:text-sm sm:tracking-[0.3em]">
          Portfolio
        </p> */}
        <h1 className="text-balance font-heading text-4xl font-extrabold leading-tight text-foreground sm:text-6xl">
          I am {profile.alias}
        </h1>
        <p className="mt-4 flex min-h-8 items-center text-lg text-muted-foreground sm:min-h-9 sm:text-2xl">
          <span className="font-medium text-foreground">{typed}</span>
          <span className="typed-caret h-6 sm:h-7" aria-hidden="true" />
        </p>
        <p className="mt-6 max-w-xl text-pretty leading-relaxed text-muted-foreground">
          Full-stack web &amp; mobile developer and QA Engineer from Phnom Penh, Cambodia —
          building reliable products across the stack.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href="#contact"
            className="inline-flex items-center rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Get in touch
          </a>
          <a
            href="#resume"
            className="inline-flex items-center rounded-full border border-border bg-card px-6 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            View resume
          </a>
        </div>
      </div>

      <a
        href="#about"
        aria-label="Scroll to About"
        className="absolute bottom-6 left-10/12 hidden -translate-x-1/2 flex-col items-center gap-1 text-muted-foreground transition-colors hover:text-primary sm:flex"
      >
        <span className="flex h-9 w-5 items-start justify-center rounded-full border border-current p-1">
          <span className="h-1.5 w-1 animate-bounce rounded-full bg-current" />
        </span>
      </a>
    </section>
  )
}
