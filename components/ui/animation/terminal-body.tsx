'use client';

import { useRef, type KeyboardEvent, type RefObject } from 'react';
import type { HistoryEntry } from '@/lib/terminal/types';

export const MATRIX_CHARS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ01';

const BOOT_LINE_CLASS = (line: string) => {
  if (line.startsWith('$')) return 'text-green-400';
  if (line.startsWith('✓')) return 'text-emerald-400';
  if (line.startsWith('○')) return 'text-green-600';
  if (line.startsWith('WELCOME')) return 'text-green-300 font-bold';
  return 'text-green-500/70';
};

interface TerminalBodyProps {
  booted: boolean;
  cleared: boolean;
  visibleLines: number;
  history: HistoryEntry[];
  promptText: string;
  draft: string;
  bootLines: string[];
  scrollRef: RefObject<HTMLDivElement | null>;
  inputRef: RefObject<HTMLInputElement | null>;
  onInputChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onBodyClick: () => void;
}

/** Terminal body — boot animation, command history, and live prompt input. */
export default function TerminalBody({
  booted,
  cleared,
  visibleLines,
  history,
  promptText,
  draft,
  bootLines,
  scrollRef,
  inputRef,
  onInputChange,
  onKeyDown,
  onBodyClick,
}: TerminalBodyProps) {
  const matrixChars = useRef<{ char: string; left: string; delay: string; duration: string }[]>(
    Array.from({ length: 24 }, (_, i) => ({
      char: MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)],
      left: `${(i * 4.3) % 100}%`,
      delay: `${(i * 0.5) % 4}s`,
      duration: `${4 + (i % 5)}s`,
    })),
  );

  return (
    <div
      ref={scrollRef}
      onClick={onBodyClick}
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '10px 12px 12px',
        fontSize: 13,
        lineHeight: 1.55,
        position: 'relative',
        zIndex: 1,
        cursor: 'text',
      }}
    >
      {/* Matrix rain, only inside the terminal window */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-10">
        {matrixChars.current.map((c, i) => (
          <span
            key={i}
            className="loader-matrix-char loader-matrix-char--window"
            style={{ left: c.left, animationDelay: c.delay, animationDuration: c.duration }}
          >
            {c.char}
          </span>
        ))}
      </div>

      {/* Boot lines with typewriter effect */}
      {!cleared &&
        bootLines.slice(0, visibleLines).map((line, i) => (
          <div key={`boot-${i}`} className={BOOT_LINE_CLASS(line)}>
            {line}
            {i === visibleLines - 1 && !booted && <span className="loader-cursor">▊</span>}
          </div>
        ))}

      {/* Command history */}
      {history.map((entry, i) => (
        <div key={`h-${i}`} className={entry.className ?? 'text-green-500/70'}>
          {entry.text}
        </div>
      ))}

      {/* Interactive prompt */}
      {booted && (
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-green-400 shrink-0 whitespace-nowrap">{promptText}$</span>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            aria-label="Terminal input"
            // 16px on mobile prevents iOS Safari auto-zoom on focus; 13px on larger screens.
            className="bg-transparent outline-none border-none text-green-300 flex-1 text-[16px] sm:text-[13px] font-mono"
            style={{ caretColor: '#22c55e', minWidth: 0 }}
          />
          <span className="loader-cursor shrink-0">▊</span>
        </div>
      )}
    </div>
  );
}