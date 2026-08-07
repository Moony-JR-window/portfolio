'use client';

import { useRef, type KeyboardEvent, type RefObject } from 'react';
import type { HistoryEntry } from '@/lib/terminal/types';

export const MATRIX_CHARS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ01';

const BOOT_LINE_CLASS = (line: string) => {
  if (line.startsWith('>')) return 'text-green-400';
  if (line.includes('[OK]')) return 'text-emerald-400';
  if (line.includes('REAL SHELL ACTIVE')) return 'text-yellow-400 font-bold';
  if (line.includes('WELCOME')) return 'text-green-300 font-bold';
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
  realShell: boolean;
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
  realShell,
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

      {/* Mode indicator */}
      {booted && !cleared && (
        <div
          className={
            realShell
              ? 'text-yellow-400/90 text-[11px] mb-1'
              : 'text-orange-400/90 text-[11px] mb-1'
          }
        >
          {realShell
            ? '● REAL SHELL — commands execute on this machine'
            : '● SIMULATED MODE — demo terminal, commands do not run'}
        </div>
      )}

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
          <div className="flex-1 overflow-x-auto overflow-y-hidden" style={{ minWidth: 0 }}>
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
              className="bg-transparent outline-none border-none text-green-300 w-full text-[16px] sm:text-[13px] font-mono whitespace-nowrap"
              style={{ caretColor: '#22c55e', minWidth: 0 }}
            />
          </div>
          <span className="loader-cursor shrink-0">▊</span>
        </div>
      )}
    </div>
  );
}