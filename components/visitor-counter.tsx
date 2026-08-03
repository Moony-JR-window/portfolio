'use client'

import { useEffect, useRef, useState } from 'react'
import { Eye, GripVertical } from 'lucide-react'

type Visits = { total: number; today: number }

function useCountUp(target: number, duration = 5000) {
  const [value, setValue] = useState(0)

  useEffect(() => {
    if (target <= 0) {
      setValue(0)
      return
    }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      setValue(Math.round(target * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])

  return value
}

export function VisitorCounter() {
  const [visits, setVisits] = useState<Visits | null>(null)

  // free drag position (px from top-left). null = default anchored (bottom-left).
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const draggingRef = useRef(false)
  const offsetRef = useRef({ x: 0, y: 0 })
  const elRef = useRef<HTMLDivElement>(null)

  
useEffect(() => {
  let cancelled = false;

  async function load() {
    try {
      const isNew = !sessionStorage.getItem("mnydev_visited");

      const res = await fetch("/api/visits", {
        method: isNew ? "GET" : "GET",
        cache: "no-store",
      });

      if (!res.ok) throw new Error();

      const data: Visits = await res.json();

      if (isNew) {
        sessionStorage.setItem("mnydev_visited", "1");
      }

      if (!cancelled) {
        setVisits(data);
      }
    } catch {
      if (!cancelled) {
        setVisits({ total: 0, today: 0 });
      }
    }
  }

  // First request immediately after mount
  load();

  // Refresh every 10 seconds
  const timer = setInterval(load, 10000);

  return () => {
    cancelled = true;
    clearInterval(timer);
  };
}, []);


  // Free dragging anywhere on screen (mouse + touch).
  useEffect(() => {
    function clamp(clientX: number, clientY: number) {
      const width = elRef.current?.offsetWidth ?? 220
      const height = elRef.current?.offsetHeight ?? 48
      const margin = 8
      const x = Math.max(
        margin,
        Math.min(clientX - offsetRef.current.x, window.innerWidth - width - margin),
      )
      const y = Math.max(
        margin,
        Math.min(clientY - offsetRef.current.y, window.innerHeight - height - margin),
      )
      return { x, y }
    }
    const move = (clientX: number, clientY: number) => {
      if (draggingRef.current) setPos(clamp(clientX, clientY))
    }
    const onMouseMove = (e: MouseEvent) => move(e.clientX, e.clientY)
    const onTouchMove = (e: TouchEvent) => {
      if (draggingRef.current) {
        e.preventDefault()
        move(e.touches[0].clientX, e.touches[0].clientY)
      }
    }
    const onUp = () => {
      draggingRef.current = false
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onUp)
    }
  }, [])

  function startDrag(clientX: number, clientY: number) {
    const el = elRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    offsetRef.current = { x: clientX - rect.left, y: clientY - rect.top }
    setPos({ x: rect.left, y: rect.top })
    draggingRef.current = true
  }

  const total = useCountUp(visits?.total ?? 0)
  const today = useCountUp(visits?.today ?? 0)
  const loading = visits === null

  return (
    <div
      ref={elRef}
      style={
        pos === null
          ? undefined
          : { left: `${pos.x}px`, top: `${pos.y}px`, bottom: 'auto', right: 'auto' }
      }
      className="fixed bottom-4 left-4 z-999 select-none"
    >
      <div className="flex items-center gap-2.5 rounded-full border border-border bg-card/80 py-2 pl-1.5 pr-4 shadow-lg backdrop-blur-md">
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault()
            startDrag(e.clientX, e.clientY)
          }}
          onTouchStart={(e) => startDrag(e.touches[0].clientX, e.touches[0].clientY)}
          aria-label="Drag to move the visitor counter anywhere on screen"
          className="flex h-8 w-6 shrink-0 cursor-grab items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>

        <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>

        <div className="flex items-center gap-1.5">
          <Eye className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="leading-none">
            <div className="font-heading text-sm font-bold tabular-nums text-foreground">
              {loading ? '—' : total.toLocaleString()}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Total visits
            </div>
          </div>
        </div>

        <div className="h-8 w-px bg-border" />

        <div className="leading-none">
          <div className="font-heading text-sm font-bold tabular-nums text-foreground">
            {loading ? '—' : today.toLocaleString()}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Today</div>
        </div>
      </div>
    </div>
  )
}
