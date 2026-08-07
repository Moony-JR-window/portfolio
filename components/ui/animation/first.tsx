'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import TerminalHeader from './terminal-header';
import TerminalBody from './terminal-body';
import { useDraggable } from '@/lib/terminal/drag';
import type { HistoryEntry, NetworkInfo, Position } from '@/lib/terminal/types';
import { HOME, FILE_SYSTEM, resolvePath, getNode } from '@/lib/terminal/file-system';
import { COMMANDS, executeCommand } from '@/lib/terminal/commands';
import { isRealShellAvailable, runRealCommand } from '@/lib/terminal/real-shell';

const DEFAULT_BOOT_LINES = [
  '> initializing secure shell...',
  '> connecting to mainframe...',
  '> handshake complete [OK]',
  '',
  '> decrypting payload...',
  '> bypassing firewall... [OK]',
  '> injecting exploit... [OK]',
  '',
  '> loading kernel modules...',
  '> mounting /dev/portfolio...',
  '> starting daemon: moonyd [OK]',
  '',
  '> establishing uplink...',
  '> spoofing MAC address... [OK]',
  '> tunneling through proxy... [OK]',
  '',
  '> access granted.',
  '> WELCOME TO MOONYDEV PORTFOLIO',
  '> type "help" to list available commands.',
];

const INITIAL_POS: Position =
  typeof window !== 'undefined' && window.innerWidth > 0
    ? { x: Math.max(8, window.innerWidth - 560), y: 90 }
    : { x: 400, y: 90 };

/** Shorten a real path like bash: /Users/mony.rorn → ~ */
function shortenPath(path: string): string {
  if (!path) return '~';
  const homeMatch = path.match(/^\/Users\/[^/]+/);
  if (homeMatch) {
    return path.replace(homeMatch[0], '~');
  }
  return path;
}

export default function TerminalOverlay() {
  const [isVisible, setIsVisible] = useState(true);
  const [booted, setBooted] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [visibleLines, setVisibleLines] = useState(0);
  const [cwd, setCwd] = useState(HOME);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [realShell, setRealShell] = useState(false);
  const [realCwd, setRealCwd] = useState('~');

  const bootLinesRef = useRef<string[]>(DEFAULT_BOOT_LINES);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const historyStackRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const prevCwdRef = useRef(HOME);
  const fsRef = useRef(FILE_SYSTEM);
  const dismissedRef = useRef(false);

  const { pos, elRef, startDrag } = useDraggable(INITIAL_POS);

  const promptText = realShell
    ? `moony@dev:${shortenPath(realCwd)}`
    : `moony@dev:${cwd.replace(/^\/home\/moony/, '~')}`;

  function pushOutput(text: string, className = 'text-green-500/70') {
    setHistory((h) => [...h, { type: 'output', text, className }]);
  }

  // Boot animation: detect real shell, fetch network info, type boot lines.
  useEffect(() => {
    let isMounted = true;
    let lineTimer: ReturnType<typeof setInterval> | null = null;
    let bootTimer: ReturnType<typeof setTimeout> | null = null;

    async function init() {
      // Detect if real shell is available (local dev mode only)
      const real = await isRealShellAvailable();
      if (!isMounted) return;
      setRealShell(real);

      if (real) {
        // Get real cwd
        const cwdOut = await runRealCommand('pwd');
        if (isMounted && cwdOut.cwd) setRealCwd(cwdOut.cwd);
      }

      try {
        const res = await fetch('/api/network');
        const data: NetworkInfo = await res.json();
        if (!isMounted) return;
        bootLinesRef.current = real
          ? [
              '> initializing secure shell...',
              '> connecting to mainframe...',
              '> handshake complete [OK]',
              '',
              '> decrypting payload...',
              '> bypassing firewall... [OK]',
              '> injecting exploit... [OK]',
              '',
              '> loading kernel modules...',
              '> mounting /dev/portfolio...',
              '> starting daemon: moonyd [OK]',
              '',
              '> establishing uplink...',
              `> target: ${data.domain}`,
              `> uplink: ${data.ip}`,
              '',
              '> REAL SHELL ACTIVE — commands run on this machine.',
              '> WELCOME TO MOONYDEV PORTFOLIO',
              '> type "help" to list available commands.',
            ]
          : [
              '> initializing secure shell...',
              '> connecting to mainframe...',
              '> handshake complete [OK]',
              '',
              '> decrypting payload...',
              '> bypassing firewall... [OK]',
              '> injecting exploit... [OK]',
              '',
              '> loading kernel modules...',
              '> mounting /dev/portfolio...',
              '> starting daemon: moonyd [OK]',
              '',
              '> establishing uplink...',
              `> target: ${data.domain}`,
              `> uplink: ${data.ip}`,
              '',
              '> ⚠ SIMULATED MODE — commands do NOT run on a real machine.',
              '>   This is a demo terminal. Type "help" to explore.',
              '> WELCOME TO MOONYDEV PORTFOLIO',
              '> type "help" to list available commands.',
            ];
      } catch {
        if (!isMounted) return;
        bootLinesRef.current = DEFAULT_BOOT_LINES;
      }

      setVisibleLines(0);
      lineTimer = setInterval(() => {
        setVisibleLines((prev) => {
          if (prev < bootLinesRef.current.length) return prev + 1;
          if (lineTimer) clearInterval(lineTimer);
          return prev;
        });
      }, 60);

      bootTimer = setTimeout(() => {
        if (isMounted) {
          setBooted(true);
          setTimeout(() => inputRef.current?.focus(), 50);
        }
      }, bootLinesRef.current.length * 60 + 500);
    }

    init();

    return () => {
      isMounted = false;
      if (lineTimer) clearInterval(lineTimer);
      if (bootTimer) clearTimeout(bootTimer);
    };
  }, []);

  // Auto-close after 5s on first load if the user never dismissed/interacted.
  useEffect(() => {
    if (!booted) return;

    const AUTO_CLOSE_MS = 5000;
    let counter = 4;

    setHistory((h) => [
      ...h,
      {
        type: 'output',
        text: 'ℹ This terminal will auto-close in 5s unless you interact.',
        className: 'text-yellow-400/80',
      },
    ]);

    const countdownTimer = setInterval(() => {
      if (counter <= 0 || dismissedRef.current) {
        clearInterval(countdownTimer);
        return;
      }
      pushOutput(`   auto-closing in ${counter}s...`, 'text-green-600');
      counter -= 1;
    }, 1000);

    const closeTimer = setTimeout(() => {
      clearInterval(countdownTimer);
      if (!dismissedRef.current) {
        setIsVisible(false);
      }
    }, AUTO_CLOSE_MS);

    return () => {
      clearTimeout(closeTimer);
      clearInterval(countdownTimer);
    };
  }, [booted]);

  // Auto-scroll to bottom when content changes.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [history, visibleLines, booted, cwd, realCwd]);

  function handleStartDrag(clientX: number, clientY: number) {
    dismissedRef.current = true;
    startDrag(clientX, clientY);
  }

  async function runCommand(raw: string) {
    const trimmed = raw.trim();
    const [cmd = '', ...args] = trimmed.split(/\s+/);
    const lower = cmd.toLowerCase();

    // Update command history (most recent first, unique, max 50).
    if (trimmed) {
      historyStackRef.current = [
        trimmed,
        ...historyStackRef.current.filter((c) => c !== trimmed),
      ].slice(0, 50);
      historyIndexRef.current = -1;
    }

    // clear / reset — wipe everything, including boot lines.
    if (lower === 'clear') {
      setHistory([]);
      setCleared(true);
      return;
    }

    // Echo the typed command with the prompt.
    setHistory((h) => [
      ...h,
      { type: 'input', text: `${promptText}$ ${raw}`, className: 'text-green-400' },
    ]);

    if (!trimmed) return;

    // ============ REAL SHELL MODE (local dev only) ============
    if (realShell) {
      // cd — server handles it and returns the new cwd
      if (lower === 'cd') {
        const target = args[0] || '~';
        const out = await runRealCommand(`cd ${target}`);
        if (out.cwd) setRealCwd(out.cwd);
        if (out.output) pushOutput(out.output, 'text-red-400');
        return;
      }

      // Special: help still shows the simulated help (works everywhere)
      if (lower === 'help' || lower === 'man') {
        const output = executeCommand(lower, args, cwd, fsRef.current, historyStackRef.current);
        if (output.length) setHistory((h) => [...h, ...output]);
        return;
      }

      // Everything else runs on the real machine
      const result = await runRealCommand(trimmed);
      // Keep prompt cwd in sync with the server
      if (result.cwd) setRealCwd(result.cwd);
      if (result.output) {
        result.output.split('\n').forEach((line) => {
          pushOutput(line, 'text-green-300');
        });
      }
      return;
    }

    // ============ SIMULATED MODE (deployed / fallback) ============

    // cd — special: mutates cwd.
    if (lower === 'cd') {
      let target = args[0] || HOME;
      if (target === '-') target = prevCwdRef.current || HOME;
      const resolved = resolvePath(cwd, target);
      const node = getNode(fsRef.current, resolved);
      if (!node || node.type !== 'dir') {
        pushOutput(`bash: cd: ${target}: No such file or directory`, 'text-red-400');
      } else {
        prevCwdRef.current = cwd;
        setCwd(resolved);
      }
      return;
    }

    // ping — streams simulated output.
    if (lower === 'ping') {
      const host = args[0] || 'localhost';
      const count = Math.min(Math.max(parseInt(args[1], 10) || 4, 1), 10);
      const ip = host === 'localhost' ? '127.0.0.1' : '192.168.1.100';
      pushOutput(`PING ${host} (${ip}): 56 data bytes`);
      for (let i = 0; i < count; i++) {
        const ms = (Math.random() * 0.4 + 0.02).toFixed(3);
        setTimeout(() => {
          pushOutput(`64 bytes from ${ip}: icmp_seq=${i} ttl=64 time=${ms} ms`);
        }, (i + 1) * 350);
      }
      setTimeout(() => {
        pushOutput(`--- ${host} ping statistics ---`);
        pushOutput(`${count} packets transmitted, ${count} packets received, 0.0% packet loss`);
        pushOutput('round-trip min/avg/max = 0.020/0.021/0.042 ms');
      }, (count + 1) * 350);
      return;
    }

    // sudo — funny.
    if (lower === 'sudo') {
      pushOutput('[sudo] password for moony:', 'text-green-500/70');
      setTimeout(() => {
        pushOutput(
          'moony is not in the sudoers file. This incident will be reported. 😅',
          'text-red-400',
        );
      }, 300);
      return;
    }

    const output = executeCommand(lower, args, cwd, fsRef.current, historyStackRef.current);
    if (output.length) setHistory((h) => [...h, ...output]);
  }

  async function handleTab(e: KeyboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const parts = draft.split(' ');
    if (parts.length === 1 && !draft.includes('/')) {
      const matches = COMMANDS.filter((c) => c.startsWith(parts[0].toLowerCase()));
      if (matches.length === 1) {
        setDraft(`${matches[0]} `);
      } else if (matches.length > 1) {
        pushOutput(matches.join('   '), 'text-green-500/70');
      }
      return;
    }

    // ============ REAL SHELL TAB COMPLETION ============
    if (realShell) {
      const last = parts[parts.length - 1];
      const slashIdx = last.lastIndexOf('/');
      const targetDir = slashIdx >= 0 ? last.slice(0, slashIdx) || '.' : '.';
      const prefix = slashIdx >= 0 ? last.slice(slashIdx + 1) : last;

      // List the target directory on the real machine
      const result = await runRealCommand(`ls -1 ${targetDir} 2>/dev/null`);
      if (!result.output) return;
      const names = result.output
        .split('\n')
        .map((n) => n.trim())
        .filter(Boolean)
        .filter((n) => n.startsWith(prefix));

      if (names.length === 1) {
        // Check if it's a directory to add trailing slash
        const check = await runRealCommand(`test -d "${targetDir}/${names[0]}" && echo DIR`);
        const sep = check.output.includes('DIR') ? '/' : ' ';
        parts[parts.length - 1] =
          targetDir === '.' ? `${names[0]}${sep}` : `${targetDir}/${names[0]}${sep}`;
        setDraft(parts.join(' '));
      } else if (names.length > 1) {
        const base = targetDir === '.' ? '' : `${targetDir}/`;
        pushOutput(names.map((n) => `${base}${n}`).join('   '), 'text-green-500/70');
      }
      return;
    }

    // ============ SIMULATED PATH COMPLETION ============
    const last = parts[parts.length - 1];
    const slashIdx = last.lastIndexOf('/');
    const targetDir = slashIdx >= 0 ? last.slice(0, slashIdx) || '.' : '.';
    const prefix = slashIdx >= 0 ? last.slice(slashIdx + 1) : last;
    const resolvedDir = resolvePath(cwd, targetDir);
    const dirNode = getNode(fsRef.current, resolvedDir);
    if (!dirNode || dirNode.type !== 'dir' || !dirNode.children) return;
    const names = Object.keys(dirNode.children).filter((n) => n.startsWith(prefix));
    if (names.length === 1) {
      const sep = dirNode.children[names[0]]?.type === 'dir' ? '/' : ' ';
      parts[parts.length - 1] =
        targetDir === '.' ? `${names[0]}${sep}` : `${targetDir}/${names[0]}${sep}`;
      setDraft(parts.join(' '));
    } else if (names.length > 1) {
      const base = targetDir === '.' ? '' : `${targetDir}/`;
      pushOutput(names.map((n) => `${base}${n}`).join('   '), 'text-green-500/70');
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    dismissedRef.current = true;
    if (e.key === 'Enter') {
      runCommand(draft);
      setDraft('');
    } else if (e.key === 'Tab') {
      handleTab(e);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(historyIndexRef.current + 1, historyStackRef.current.length - 1);
      if (next >= 0 && historyStackRef.current[next] !== undefined) {
        historyIndexRef.current = next;
        setDraft(historyStackRef.current[next]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndexRef.current > 0) {
        historyIndexRef.current -= 1;
        setDraft(historyStackRef.current[historyIndexRef.current]);
      } else {
        historyIndexRef.current = -1;
        setDraft('');
      }
    }
  }

  // Closed state: show a small ">_" button to reopen the terminal.
  if (!isVisible) {
    return (
      <button
        onClick={() => {
          setIsVisible(true);
          setMinimized(false);
        }}
        title="Open terminal"
        aria-label="Open terminal"
        style={{
          position: 'fixed',
          bottom: 80,
          left: 16,
          zIndex: 9998,
          width: 48,
          height: 48,
          borderRadius: 10,
          background: '#0d130d',
          color: '#22c55e',
          fontSize: 20,
          fontWeight: 700,
          border: '1px solid rgba(34,197,94,0.4)',
          boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
          cursor: 'pointer',
          fontFamily: 'monospace',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {'>_'}
      </button>
    );
  }

  // Minimized state: macOS-style dock bar that restores the terminal on click.
  if (minimized) {
    return (
      <div
        ref={elRef}
        onMouseDown={(e) => handleStartDrag(e.clientX, e.clientY)}
        onTouchStart={(e) => handleStartDrag(e.touches[0].clientX, e.touches[0].clientY)}
        onClick={() => setMinimized(false)}
        title="Restore terminal"
        style={{
          position: 'fixed',
          left: pos?.x ?? 16,
          bottom: 16,
          width: 260,
          borderRadius: 10,
          background: 'rgba(8, 12, 8, 0.92)',
          border: '1px solid rgba(34,197,94,0.3)',
          boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          zIndex: 9999,
          cursor: 'move',
          userSelect: 'none',
          touchAction: 'none',
          fontFamily: "'SF Mono', Menlo, Monaco, 'Courier New', monospace",
        }}
      >
        <span className="w-3 h-3 rounded-full bg-red-500/80" />
        <span className="w-3 h-3 rounded-full bg-yellow-500/80" />
        <span className="w-3 h-3 rounded-full bg-green-500/80" />
        <span className="ml-2 text-xs text-green-500/60 font-mono truncate">
          moony@dev: {realShell ? realCwd : '~/portfolio'}
        </span>
      </div>
    );
  }

  return (
    <div
      ref={elRef}
      style={{
        position: 'fixed',
        left: pos?.x ?? 400,
        top: pos?.y ?? 90,
        width: expanded ? 680 : 520,
        maxWidth: 'calc(100vw - 16px)',
        height: expanded ? 460 : 360,
        maxHeight: 'calc(100vh - 16px)',
        borderRadius: 12,
        overflow: 'hidden',
        background: 'rgba(8, 12, 8, 0.92)',
        border: '1px solid rgba(34,197,94,0.3)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.45), 0 0 30px rgba(34,197,94,0.12)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 9999,
        fontFamily: "'SF Mono', Menlo, Monaco, 'Courier New', monospace",
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      <TerminalHeader
        expanded={expanded}
        onClose={() => {
          dismissedRef.current = true;
          setIsVisible(false);
        }}
        onMinimize={() => {
          dismissedRef.current = true;
          setMinimized(true);
        }}
        onToggleExpand={() => setExpanded((s) => !s)}
        onStartDrag={handleStartDrag}
      />

      <TerminalBody
        booted={booted}
        cleared={cleared}
        visibleLines={visibleLines}
        history={history}
        promptText={promptText}
        draft={draft}
        bootLines={bootLinesRef.current}
        realShell={realShell}
        scrollRef={scrollRef}
        inputRef={inputRef}
        onInputChange={(value) => {
          dismissedRef.current = true;
          setDraft(value);
        }}
        onKeyDown={handleKeyDown}
        onBodyClick={() => {
          dismissedRef.current = true;
          inputRef.current?.focus();
        }}
      />
    </div>
  );
}