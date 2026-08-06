'use client';

import { useEffect, useRef, useState } from 'react';

const MATRIX_CHARS = '01<>/\\|{}[]()#$%&*+-=?!@^~`;:,.';

const DEFAULT_TERMINAL_LINES = [
  '$ npm run dev',
  '> portfolio-website@1.0.0 dev',
  '> next dev --turbopack',
  '',
  '✓ Ready in 1.02s',
  '   - Local:        http://localhost:3000',
  '   - Network:      http://192.168.1.100:3000',
  '',
  '✓ Compiled / in 892ms',
  '○ Compiling / ...',
  '✓ Compiled / in 421ms',
  '○ Collecting page data ...',
  '✓ Generating static pages (5/5)',
  '✓ Finalizing page optimization ...',
  '',
  'WELCOME TO MOONYDEV PORTFOLIO',
];

interface NetworkInfo {
  ip: string;
  host: string;
  domain: string;
  protocol: string;
  userAgent: string;
}

export default function LoadingAnimation() {
  const [visibleLines, setVisibleLines] = useState(0);
  const [isVisible, setIsVisible] = useState(true);
  const [isExiting, setIsExiting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [terminalLines, setTerminalLines] = useState<string[]>(DEFAULT_TERMINAL_LINES);
  const linesRef = useRef<string[]>(DEFAULT_TERMINAL_LINES);

  useEffect(() => {
    let isMounted = true;

    // Fetch network info (IP, domain) dynamically
    async function fetchNetworkInfo() {
      try {
        const res = await fetch('/api/network');
        const data: NetworkInfo = await res.json();

        if (!isMounted) return;

        const dynamicLines = [
          '$ npm run dev',
          '> portfolio-website@1.0.0 dev',
          '> next dev --turbopack',
          '',
          '✓ Ready in 1.02s',
          `   - Local:        ${data.domain}`,
          `   - Network:      ${data.ip}`,
          '',
          '✓ Compiled / in 892ms',
          '○ Compiling / ...',
          '✓ Compiled / in 421ms',
          '○ Collecting page data ...',
          '✓ Generating static pages (5/5)',
          '✓ Finalizing page optimization ...',
          '',
          'WELCOME TO MOONYDEV PORTFOLIO',
        ];

        linesRef.current = dynamicLines;
        setTerminalLines(dynamicLines);
      } catch {
        // Keep default lines if API fails
        if (!isMounted) return;
        linesRef.current = DEFAULT_TERMINAL_LINES;
        setTerminalLines(DEFAULT_TERMINAL_LINES);
      }
    }

    fetchNetworkInfo();

    // Type terminal lines one by one (slower to fit in 3s)
    const lineInterval = setInterval(() => {
      setVisibleLines((prev) => {
        if (prev < linesRef.current.length) return prev + 1;
        clearInterval(lineInterval);
        return prev;
      });
    }, 120);

    // Animate progress from 0 to 100 over 2.7s
    const start = Date.now();
    const duration = 2700;

    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min((elapsed / duration) * 100, 100);
      setProgress(pct);
      if (pct >= 100) clearInterval(progressInterval);
    }, 25);

    // Trigger exit animation at 2.7s
    const exitTimer = setTimeout(() => {
      setIsExiting(true);
    }, 3700);

    // Remove from DOM at 3s
    const removeTimer = setTimeout(() => {
      setIsVisible(false);
    }, 4000);

    return () => {
      isMounted = false;
      clearInterval(lineInterval);
      clearInterval(progressInterval);
      clearTimeout(exitTimer);
      clearTimeout(removeTimer);
    };
  }, []);

  if (!isVisible) return null;

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center bg-[#0a0e0a] z-[9999] ${
        isExiting ? 'loader-fade-out' : ''
      }`}
    >
      {/* Matrix rain background */}
      <div className="absolute inset-0 overflow-hidden opacity-20 pointer-events-none">
        {[...Array(30)].map((_, i) => (
          <span
            key={i}
            className="loader-matrix-char"
            style={{
              left: `${(i * 3.4) % 100}%`,
              animationDelay: `${(i * 0.5) % 4}s`,
              animationDuration: `${3 + (i % 5)}s`,
            }}
          >
            {MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)]}
          </span>
        ))}
      </div>

      <div className="relative flex flex-col items-center justify-center px-4">
        {/* Terminal window */}
        <div className="w-full max-w-lg rounded-lg border border-green-500/30 bg-black/80 backdrop-blur-sm shadow-[0_0_30px_rgba(34,197,94,0.15)] overflow-hidden loader-terminal-pop">
          {/* Terminal header */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-green-500/20 bg-[#0d130d]">
            <span className="w-3 h-3 rounded-full bg-red-500/80" />
            <span className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <span className="w-3 h-3 rounded-full bg-green-500/80" />
            <span className="ml-3 text-xs text-green-500/60 font-mono">
              moony@dev: ~/portfolio
            </span>
          </div>

          {/* Terminal body - typed lines */}
          <div className="px-4 py-4 font-mono text-[13px] leading-relaxed min-h-[200px]">
            {terminalLines.slice(0, visibleLines).map((line, i) => (
              <div
                key={i}
                className={
                  line.startsWith('$')
                    ? 'text-green-400'
                    : line.startsWith('✓')
                      ? 'text-emerald-400'
                      : line.startsWith('○')
                        ? 'text-green-600'
                        : line.startsWith('WELCOME')
                          ? 'text-green-300 font-bold'
                          : 'text-green-500/70'
                }
              >
                {line}
                {i === visibleLines - 1 && (
                  <span className="loader-cursor">▊</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full max-w-lg mt-4">
          <div className="flex justify-between items-center mb-1.5">
            <span className="text-xs text-green-500/80 font-mono">
              {'>'} LOADING SYSTEM...
            </span>
            <span className="text-xs text-green-400 font-mono">
              {Math.round(progress)}%
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-green-500/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-green-700 to-green-400 loader-progress-glow"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* M logo with glitch effect */}
        <div className="mt-6 relative">
          <span className="text-5xl font-bold text-green-400 font-mono loader-glitch" data-text="M">
            M
          </span>
        </div>

        <p className="mt-3 text-sm text-green-500/60 font-mono tracking-widest">
          MOONYDEV_ACCESS_GRANTED
        </p>
      </div>
    </div>
  );
}