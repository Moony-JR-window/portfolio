'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  const [mounted, setMounted] = useState(false)

useEffect(() => {
  setMounted(true)

  let savedTheme: "light" | "dark" | null = null

  try {
    savedTheme = localStorage.getItem("theme") as "light" | "dark" | null
  } catch {}

  const theme = savedTheme ?? "dark"

  const root = document.documentElement
  root.classList.remove("light", "dark")
  root.classList.add(theme)

  setTheme(theme)
}, [])

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark'
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(next)
    try {
      localStorage.setItem('theme', next)
    } catch {}
    setTheme(next)
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      {mounted && theme === 'dark' ? (
        <Sun className="h-[18px] w-[18px]" />
      ) : (
        <Moon className="h-[18px] w-[18px]" />
      )}
    </button>
  )
}
