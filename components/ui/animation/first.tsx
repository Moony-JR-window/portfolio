'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

const MATRIX_CHARS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ01';

const DEFAULT_BOOT_LINES = [
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
  'Type "help" to list available commands.',
];

interface NetworkInfo {
  ip: string;
  host: string;
  domain: string;
  protocol: string;
  userAgent: string;
}

interface HistoryEntry {
  type: 'input' | 'output';
  text: string;
  className?: string;
}

/* ===================== Virtual File System ===================== */

interface FSNode {
  type: 'file' | 'dir';
  content?: string;
  children?: Record<string, FSNode>;
}

const HOME = '/home/moony';

const FILE_SYSTEM: FSNode = {
  type: 'dir',
  children: {
    home: {
      type: 'dir',
      children: {
        moony: {
          type: 'dir',
          children: {
            'about.txt': {
              type: 'file',
              content:
                'Moony — full-stack developer & UI/UX enthusiast.\n' +
                'Passionate about building fast, beautiful web experiences.\n' +
                'Currently exploring Next.js, WebSockets, and creative frontends.',
            },
            'skills.txt': {
              type: 'file',
              content:
                'Frontend : React, Next.js, TypeScript, Tailwind CSS\n' +
                'Backend  : Node.js, Python, REST APIs, WebSockets\n' +
                'Tools    : Git, Docker, Figma, Vite, pnpm',
            },
            'projects.txt': {
              type: 'file',
              content:
                '1. portfolio   — this website (Next.js + live chat + terminal)\n' +
                '2. chat-app    — realtime chat with WebSockets\n' +
                '3. more coming soon — stay tuned!',
            },
            'contact.txt': {
              type: 'file',
              content: 'Email  : hello@moony.dev\nGitHub : github.com/Moony-JR-window',
            },
            'README.md': {
              type: 'file',
              content:
                '# MoonyDev Portfolio\n\n' +
                'An interactive portfolio with a Linux-style terminal.\n\n' +
                'Run `help` inside the terminal to explore.\n\n' +
                'Happy hacking!',
            },
            projects: {
              type: 'dir',
              children: {
                portfolio: {
                  type: 'dir',
                  children: {
                    'README.md': {
                      type: 'file',
                      content:
                        '# portfolio\n\nNext.js + Tailwind CSS + live chat + terminal + visitor counter.\n',
                    },
                    'package.json': {
                      type: 'file',
                      content: '{\n  "name": "portfolio",\n  "version": "1.0.0",\n  ' +
                        '"scripts": { "dev": "next dev --turbopack" }\n}\n',
                    },
                  },
                },
                'chat-app': {
                  type: 'dir',
                  children: {
                    'README.md': {
                      type: 'file',
                      content: '# chat-app\n\nRealtime community chat built with WebSockets.\n',
                    },
                  },
                },
                dotfiles: { type: 'dir', children: {} },
              },
            },
            src: {
              type: 'dir',
              children: {
                'index.ts': { type: 'file', content: 'export const hello = "world";\n' },
                'styles.css': { type: 'file', content: '* { box-sizing: border-box; }\n' },
                '.hidden-secret': { type: 'file', content: 'You found the secret! 🎉\n' },
              },
            },
          },
        },
      },
    },
  },
};

/** Normalize a path (handles ~, .., ., absolute & relative). */
function resolvePath(cwd: string, raw: string): string {
  if (raw === '~') return HOME;
  let base: string[];
  if (raw.startsWith('~/')) {
    base = HOME.split('/').filter(Boolean);
    raw = raw.slice(2);
  } else if (raw.startsWith('/')) {
    base = [];
  } else {
    base = cwd.split('/').filter(Boolean);
  }
  const parts = [...base, ...raw.split('/').filter(Boolean)];
  const stack: string[] = [];
  for (const p of parts) {
    if (p === '.' || p === '') continue;
    if (p === '..') {
      stack.pop();
    } else {
      stack.push(p);
    }
  }
  return '/' + stack.join('/');
}

function getNode(fs: FSNode, path: string): FSNode | null {
  if (path === '/') return fs;
  const parts = path.split('/').filter(Boolean);
  let node: FSNode = fs;
  for (const p of parts) {
    if (node.type !== 'dir' || !node.children) return null;
    node = node.children[p];
    if (!node) return null;
  }
  return node;
}

function countDirs(n: FSNode): number {
  if (n.type !== 'dir' || !n.children) return 0;
  return 1 + Object.values(n.children).reduce((acc, c) => acc + countDirs(c), 0);
}

function countFiles(n: FSNode): number {
  if (n.type === 'file') return 1;
  if (!n.children) return 0;
  return Object.values(n.children).reduce((acc, c) => acc + countFiles(c), 0);
}

function treeLines(n: FSNode, prefix: string): string[] {
  const out: string[] = [];
  const entries = Object.entries(n.children ?? {}).sort(([a], [b]) => a.localeCompare(b));
  entries.forEach(([childName, child], i) => {
    const last = i === entries.length - 1;
    const connector = last ? '└── ' : '├── ';
    const childPrefix = prefix + (last ? '    ' : '│   ');
    if (child.type === 'dir') {
      out.push(`${prefix}${connector}${childName}/`);
      out.push(...treeLines(child, childPrefix));
    } else {
      out.push(`${prefix}${connector}${childName}`);
    }
  });
  return out;
}

/* ===================== Helpers ===================== */

const errorText = (text: string): HistoryEntry[] => [
  { type: 'output', text, className: 'text-red-400' },
];

const COMMANDS = [
  'help', 'man', 'ls', 'cd', 'pwd', 'cat', 'mkdir', 'touch', 'rm',
  'tree', 'echo', 'date', 'whoami', 'hostname', 'uname', 'history',
  'ping', 'sudo', 'open', 'fortune', 'clear', 'neofetch',
];

const FORTUNES = [
  'There are only two hard things in CS: cache invalidation, naming things, and off-by-one errors.',
  'Why do programmers prefer dark mode? Because light attracts bugs.',
  'The best way to predict the future is to implement it.',
  'Stay hungry, stay foolish. — Steve Jobs',
  'Code is like humor. When you have to explain it, it is bad.',
  'It works on my machine. — Famous last words',
  'First, solve the problem. Then, write the code.',
  'Talk is cheap. Show me the code. — Linus Torvalds',
];

/* ===================== Man pages ===================== */

const MAN_PAGES: Record<string, string[]> = {
  help: [
    'HELP(1)                    User Commands                    HELP(1)',
    '',
    'NAME',
    '       help - display information about builtin commands',
    '',
    'SYNOPSIS',
    '       help [command]',
    '',
    'DESCRIPTION',
    '       With no arguments, lists all available commands. With an',
    '       argument, shows the man page for that command.',
  ],
  man: [
    'MAN(1)                     User Commands                     MAN(1)',
    '',
    'NAME',
    '       man - an interface to the system reference manuals',
    '',
    'SYNOPSIS',
    '       man <command>',
    '',
    'DESCRIPTION',
    '       Displays the manual page for the given command.',
    '',
    'EXAMPLES',
    '       man ls',
    '       man cd',
  ],
  ls: [
    'LS(1)                      User Commands                     LS(1)',
    '',
    'NAME',
    '       ls - list directory contents',
    '',
    'SYNOPSIS',
    '       ls [-la] [path]',
    '',
    'DESCRIPTION',
    '       List information about files and directories inside the',
    '       simulated portfolio file system.',
    '',
    'OPTIONS',
    '       -a    show hidden files (starting with .)',
    '       -l    long format with permissions and sizes',
    '',
    'EXAMPLES',
    '       ls',
    '       ls -la',
    '       ls projects',
    '       ls ../',
  ],
  cd: [
    'CD(1)                       User Commands                     CD(1)',
    '',
    'NAME',
    '       cd - change the working directory',
    '',
    'SYNOPSIS',
    '       cd [directory]',
    '',
    'DESCRIPTION',
    '       Change the current working directory. No argument goes to ~.',
    '',
    'EXAMPLES',
    '       cd projects',
    '       cd ..',
    '       cd ~',
    '       cd -    (previous directory)',
  ],
  pwd: [
    'PWD(1)                     User Commands                     PWD(1)',
    '',
    'NAME',
    '       pwd - print name of current/working directory',
    '',
    'SYNOPSIS',
    '       pwd',
    '',
    'DESCRIPTION',
    '       Print the absolute path of the current working directory.',
  ],
  cat: [
    'CAT(1)                     User Commands                     CAT(1)',
    '',
    'NAME',
    '       cat - concatenate files and print on the standard output',
    '',
    'SYNOPSIS',
    '       cat <file...>',
    '',
    'EXAMPLES',
    '       cat about.txt',
    '       cat projects/portfolio/README.md',
  ],
  mkdir: [
    'MKDIR(1)                   User Commands                   MKDIR(1)',
    '',
    'NAME',
    '       mkdir - make directories',
    '',
    'SYNOPSIS',
    '       mkdir <name>',
    '',
    'DESCRIPTION',
    '       Create a directory inside the virtual file system.',
    '',
    'EXAMPLES',
    '       mkdir notes',
    '       mkdir projects/app',
  ],
  touch: [
    'TOUCH(1)                   User Commands                   TOUCH(1)',
    '',
    'NAME',
    '       touch - change file timestamps / create empty files',
    '',
    'SYNOPSIS',
    '       touch <file>',
    '',
    'DESCRIPTION',
    '       Create a new empty file in the virtual file system.',
  ],
  rm: [
    'RM(1)                       User Commands                     RM(1)',
    '',
    'NAME',
    '       rm - remove files or directories',
    '',
    'SYNOPSIS',
    '       rm [-r] <name>',
    '',
    'OPTIONS',
    '       -r    remove directories recursively',
    '',
    'EXAMPLES',
    '       rm old.txt',
    '       rm -r notes',
  ],
  tree: [
    'TREE(1)                    User Commands                    TREE(1)',
    '',
    'NAME',
    '       tree - list contents of directories in a tree-like format',
    '',
    'SYNOPSIS',
    '       tree [path]',
    '',
    'DESCRIPTION',
    '       Recursively displays the structure of a directory.',
  ],
  echo: [
    'ECHO(1)                     User Commands                     ECHO(1)',
    '',
    'NAME',
    '       echo - display a line of text',
    '',
    'SYNOPSIS',
    '       echo [text...]',
    '',
    'DESCRIPTION',
    '       Write arguments to the standard output.',
  ],
  date: [
    'DATE(1)                    User Commands                    DATE(1)',
    '',
    'NAME',
    '       date - print or set the system date and time',
    '',
    'SYNOPSIS',
    '       date',
    '',
    'DESCRIPTION',
    '       Display the current date and time.',
  ],
  whoami: [
    'WHOAMI(1)                   User Commands                   WHOAMI(1)',
    '',
    'NAME',
    '       whoami - print effective user name',
    '',
    'SYNOPSIS',
    '       whoami',
    '',
    'DESCRIPTION',
    '       Print the user name associated with the current session.',
  ],
  hostname: [
    'HOSTNAME(1)                User Commands                HOSTNAME(1)',
    '',
    'NAME',
    '       hostname - show or set the system host name',
    '',
    'SYNOPSIS',
    '       hostname',
  ],
  uname: [
    'UNAME(1)                   User Commands                   UNAME(1)',
    '',
    'NAME',
    '       uname - print system information',
    '',
    'SYNOPSIS',
    '       uname [-a]',
    '',
    'DESCRIPTION',
    '       Print kernel / OS information. -a shows everything.',
  ],
  history: [
    'HISTORY(1)                 User Commands                 HISTORY(1)',
    '',
    'NAME',
    '       history - GNU History Library',
    '',
    'SYNOPSIS',
    '       history [n]',
    '',
    'DESCRIPTION',
    '       Display the command history. Without n, lists all.',
  ],
  ping: [
    'PING(8)                     System Manager                   PING(8)',
    '',
    'NAME',
    '       ping - send ICMP ECHO_REQUEST to network hosts',
    '',
    'SYNOPSIS',
    '       ping <host> [count]',
    '',
    'DESCRIPTION',
    '       Send simulated echo requests and report round-trip times.',
  ],
  sudo: [
    'SUDO(8)                   System Manager                   SUDO(8)',
    '',
    'NAME',
    '       sudo - execute a command as another user (spoiler: no)',
    '',
    'SYNOPSIS',
    '       sudo <command>',
    '',
    'DESCRIPTION',
    '       Attempts root powers inside the simulated terminal.',
  ],
  open: [
    'OPEN(1)                     User Commands                     OPEN(1)',
    '',
    'NAME',
    '       open - open files and directories',
    '',
    'SYNOPSIS',
    '       open <file>',
    '',
    'DESCRIPTION',
    '       Simulated macOS-style open. Use cat to read files instead.',
  ],
  fortune: [
    'FORTUNE(6)                    Games                       FORTUNE(6)',
    '',
    'NAME',
    '       fortune - print a random, hopefully interesting, adage',
    '',
    'SYNOPSIS',
    '       fortune',
  ],
  clear: [
    'CLEAR(1)                   User Commands                   CLEAR(1)',
    '',
    'NAME',
    '       clear - clear the terminal screen',
    '',
    'SYNOPSIS',
    '       clear',
  ],
  neofetch: [
    'NEOFETCH(1)               User Commands               NEOFETCH(1)',
    '',
    'NAME',
    '       neofetch - a fast, highly customizable system info script',
    '',
    'SYNOPSIS',
    '       neofetch',
    '',
    'DESCRIPTION',
    '       Display system information in a pretty ASCII art layout.',
  ],
};

/* ===================== Command implementations ===================== */

function helpCmd(args: string[]): HistoryEntry[] {
  if (args.length > 0) return manCmd(args);
  const out: HistoryEntry[] = [
    { type: 'output', text: '', className: 'text-green-500/70' },
    { type: 'output', text: 'Available commands:', className: 'text-green-300 font-bold' },
  ];
  const cmds: [string, string][] = [
    ['help', 'show this help'],
    ['man <cmd>', 'view a manual page'],
    ['ls [-la] [path]', 'list directory contents'],
    ['cd <path>', 'change directory'],
    ['pwd', 'print working directory'],
    ['cat <file>', 'print file contents'],
    ['mkdir <dir>', 'create a directory'],
    ['touch <file>', 'create an empty file'],
    ['rm [-r] <name>', 'remove files / directories'],
    ['tree [path]', 'show directory tree'],
    ['echo [...]', 'print text'],
    ['date', 'show current date'],
    ['whoami', 'who are you?'],
    ['hostname', 'show hostname'],
    ['uname [-a]', 'system information'],
    ['history [n]', 'show command history'],
    ['ping <host>', 'ping a host'],
    ['sudo <cmd>', 'try root powers (spoiler)'],
    ['open <file>', 'open a file'],
    ['fortune', 'random quote'],
    ['neofetch', 'system info art'],
    ['clear', 'clear the terminal'],
  ];
  for (const [c, d] of cmds) {
    out.push({
      type: 'output',
      text: `  ${c.padEnd(18)}${d}`,
      className: 'text-green-500/70',
    });
  }
  out.push({ type: 'output', text: '', className: 'text-green-500/70' });
  out.push({
    type: 'output',
    text: 'Tip: press Tab for completion, ↑/↓ to browse history.',
    className: 'text-green-600',
  });
  return out;
}

function manCmd(args: string[]): HistoryEntry[] {
  const target = args[0]?.toLowerCase();
  if (!target) {
    return errorText("What manual page do you want?\nFor example, try 'man ls'.");
  }
  const page = MAN_PAGES[target];
  if (!page) return errorText(`No manual entry for ${target}`);
  const headingRe = /^(NAME|SYNOPSIS|DESCRIPTION|OPTIONS|EXAMPLES|SEE ALSO)$/;
  return page.map((line, i) => {
    const isHeading = headingRe.test(line.trim()) || line !== line.toUpperCase();
    const isTitle = i < 2 && /\([0-9]\)/.test(line);
    return {
      type: 'output',
      text: line,
      className: isTitle
        ? 'text-green-300 font-bold'
        : isHeading
          ? 'text-green-300 font-bold'
          : i === 0 || line === ''
            ? 'text-green-500/70'
            : 'text-green-500/70',
    };
  });
}

function lsCmd(args: string[], cwd: string, fs: FSNode): HistoryEntry[] {
  const flags = args.filter((a) => a.startsWith('-') && a !== '-' && a !== '--help').join('');
  const target = args.find((a) => !a.startsWith('-')) ?? cwd;
  const showAll = flags.includes('a');
  const long = flags.includes('l');

  if (args.includes('--help')) return manCmd(['ls']);

  const resolved = resolvePath(cwd, target);
  const node = getNode(fs, resolved);
  if (!node) return errorText(`ls: cannot access '${target}': No such file or directory`);
  if (node.type === 'file') {
    return [{ type: 'output', text: target.split('/').pop() ?? target, className: 'text-green-300' }];
  }

  const entries = Object.entries(node.children ?? {})
    .filter(([name]) => showAll || !name.startsWith('.'))
    .sort(([a], [b]) => a.localeCompare(b));

  if (long) {
    const lines: string[] = [`total ${entries.length}`];
    if (showAll) {
      lines.push('drwxr-xr-x  2 moony staff    64 Jan  1 12:00 ./');
      lines.push('drwxr-xr-x  3 moony staff    96 Jan  1 12:00 ../');
    }
    for (const [name, child] of entries) {
      const perms = child.type === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--';
      const size = child.type === 'dir' ? 64 : (child.content?.length ?? 0);
      const suffix = child.type === 'dir' ? '/' : '';
      lines.push(
        `${perms}  1 moony staff    ${String(size).padStart(4)} Jan  1 12:00 ${name}${suffix}`,
      );
    }
    return lines.map((text) => ({ type: 'output', text, className: 'text-green-500/70' }));
  }

  const names = entries.map(([name, child]) => `${name}${child.type === 'dir' ? '/' : ''}`);
  return [{ type: 'output', text: names.join('   '), className: 'text-green-300' }];
}

function catCmd(args: string[], cwd: string, fs: FSNode): HistoryEntry[] {
  if (args.length === 0) return errorText('cat: missing operand\nTry \'cat --help\'.');
  const out: HistoryEntry[] = [];
  for (const f of args) {
    const resolved = resolvePath(cwd, f);
    const node = getNode(fs, resolved);
    if (!node) {
      out.push({ type: 'output', text: `cat: ${f}: No such file or directory`, className: 'text-red-400' });
      continue;
    }
    if (node.type === 'dir') {
      out.push({ type: 'output', text: `cat: ${f}: Is a directory`, className: 'text-red-400' });
      continue;
    }
    (node.content ?? '').split('\n').forEach((line) => {
      out.push({ type: 'output', text: line, className: 'text-green-300' });
    });
    out.push({ type: 'output', text: '', className: 'text-green-500/70' });
  }
  return out;
}

function mkdirCmd(args: string[], cwd: string, fs: FSNode): HistoryEntry[] {
  if (args.length === 0) return errorText('mkdir: missing operand');
  const out: HistoryEntry[] = [];
  for (const dir of args) {
    const parts = dir.replace(/^\/+/, '').split('/').filter(Boolean);
    if (parts.length === 0) continue;
    const absParts = [...cwd.split('/').filter(Boolean), ...parts];
    let node: FSNode | null = fs;
    let i = 0;
    for (; i < absParts.length - 1; i++) {
      if (node.type !== 'dir' || !node.children) break;
      node = node.children[absParts[i]] ?? null;
      if (!node) break;
    }
    const name = absParts[absParts.length - 1];
    if (node?.type === 'dir' && node.children) {
      if (node.children[name]) {
        out.push(errorText(`mkdir: cannot create directory '${dir}': File exists`)[0]);
      } else {
        node.children[name] = { type: 'dir', children: {} };
      }
    } else {
      out.push(errorText(`mkdir: cannot create directory '${dir}': No such file or directory`)[0]);
    }
  }
  return out;
}

function touchCmd(args: string[], cwd: string, fs: FSNode): HistoryEntry[] {
  if (args.length === 0) return errorText('touch: missing file operand');
  const out: HistoryEntry[] = [];
  for (const file of args) {
    const parts = file.replace(/^\/+/, '').split('/').filter(Boolean);
    if (parts.length === 0) continue;
    const absParts = [...cwd.split('/').filter(Boolean), ...parts];
    let node: FSNode | null = fs;
    let i = 0;
    for (; i < absParts.length - 1; i++) {
      if (node.type !== 'dir' || !node.children) break;
      node = node.children[absParts[i]] ?? null;
      if (!node) break;
    }
    const name = absParts[absParts.length - 1];
    if (node?.type === 'dir' && node.children) {
      if (!node.children[name]) {
        node.children[name] = { type: 'file', content: '' };
      }
    } else {
      out.push(errorText(`touch: cannot touch '${file}': No such file or directory`)[0]);
    }
  }
  return out;
}

function rmCmd(args: string[], cwd: string, fs: FSNode): HistoryEntry[] {
  let recursive = false;
  const targets = args.filter((a) => {
    if (/^-r/.test(a) || /^-rf/.test(a) || /^-fr/.test(a)) {
      recursive = true;
      return false;
    }
    return true;
  });
  if (targets.length === 0) return errorText('rm: missing operand');
  const out: HistoryEntry[] = [];
  for (const t of targets) {
    const absolute = t.startsWith('/') || cwd === '/';
    const parts = t.replace(/^\/+/, '').split('/').filter(Boolean);
    if (parts.length === 0) {
      out.push(errorText(`rm: cannot remove '/': Permission denied`)[0]);
      continue;
    }
    const baseParts = absolute ? [] : cwd.split('/').filter(Boolean);
    const absParts = [...baseParts, ...parts];
    const name = absParts.pop() ?? '';
    let parent: FSNode | null = fs;
    let ok = true;
    for (const p of absParts) {
      if (parent.type !== 'dir' || !parent.children) {
        ok = false;
        break;
      }
      parent = parent.children[p] ?? null;
      if (!parent) {
        ok = false;
        break;
      }
    }
    if (!ok || !parent || parent.type !== 'dir' || !parent.children) {
      out.push(errorText(`rm: cannot remove '${t}': No such file or directory`)[0]);
      continue;
    }
    const node = parent.children[name];
    if (!node) {
      out.push(errorText(`rm: cannot remove '${t}': No such file or directory`)[0]);
      continue;
    }
    if (node.type === 'dir' && !recursive) {
      out.push(errorText(`rm: cannot remove '${t}': Is a directory`)[0]);
      continue;
    }
    delete parent.children[name];
  }
  return out;
}

function treeCmd(args: string[], cwd: string, fs: FSNode): HistoryEntry[] {
  const target = args[0] ?? cwd;
  const resolved = resolvePath(cwd, target);
  const node = getNode(fs, resolved);
  if (!node) return errorText(`tree: ${target}: No such file or directory`);
  if (node.type === 'file') {
    return [{ type: 'output', text: resolved.split('/').pop() ?? resolved, className: 'text-green-300' }];
  }
  const base =
    resolved === '/'
      ? 'portfolio'
      : resolved.split('/').pop() || target;
  const lines = [`${base}/`, ...treeLines(node, ''), ''];
  lines.push(`${countDirs(node)} directories, ${countFiles(node)} files`);
  return lines.map((text) => ({ type: 'output', text, className: 'text-green-500/70' }));
}

function unameCmd(args: string[]): HistoryEntry[] {
  const all = args.includes('-a') || args.includes('--all');
  const m = { s: 'PortfolioOS', n: 'dev', r: '1.0.0-portfolio', m: 'Portfolio', p: 'x86_64' };
  if (all) {
    return [{ type: 'output', text: `${m.s} ${m.n} ${m.r} ${m.m} ${m.p}`, className: 'text-green-500/70' }];
  }
  if (args.length === 0) {
    return [{ type: 'output', text: m.s, className: 'text-green-500/70' }];
  }
  const flags = args[0].replace(/^-+/, '').split('');
  const out = flags.map((f) => (m as Record<string, string>)[f] ?? '').filter(Boolean).join(' ');
  return [{ type: 'output', text: out || m.s, className: 'text-green-500/70' }];
}

function historyCmd(args: string[], stack: string[]): HistoryEntry[] {
  const n = parseInt(args[0], 10);
  const items = [...stack].reverse();
  const shown = Number.isFinite(n) && n > 0 ? [...stack].reverse().slice(-n) : items;
  if (shown.length === 0) {
    return [{ type: 'output', text: '  (no history yet)', className: 'text-green-500/70' }];
  }
  return shown.map((c, i) => ({
    type: 'output',
    text: `  ${i + 1}  ${c}`,
    className: 'text-green-500/70',
  }));
}

function neofetchCmd(): HistoryEntry[] {
  const lines = [
    '       ████',
    '      ██████',
    '     ██ ██ ██',
    '    ██  ██  ██',
    '   ██ ██████ ██',
    '  ██████████████',
    '       ████',
    '',
  ];
  const info = [
    'moony@dev',
    '────────────────',
    'OS: PortfolioOS 1.0.0 x86_64',
    'Host: M3 MacBook Pro',
    'Kernel: 6.1.0-portfolio',
    'Uptime: ∞',
    'Shell: bash 5.2.15',
    'Terminal: portfolio-terminal',
    'CPU: M3 Pro (12 cores)',
    'Memory: 36GiB / 36GiB',
  ];
  const out: HistoryEntry[] = [];
  const max = Math.max(lines.length, info.length);
  const pad = Math.max(...lines.map((l) => l.length)) + 3;
  for (let i = 0; i < max; i++) {
    const left = lines[i] ?? '';
    const right = info[i] ?? '';
    if (i < lines.length && info[i]) {
      out.push({
        type: 'output',
        text: left.padEnd(pad) + right,
        className: 'text-green-300',
      });
    } else if (i < lines.length) {
      out.push({ type: 'output', text: left, className: 'text-green-300' });
    } else {
      out.push({ type: 'output', text: ' '.repeat(pad) + right, className: 'text-green-300' });
    }
  }
  return out;
}

function openCmd(args: string[]): HistoryEntry[] {
  if (args.length === 0) return errorText('open: missing file operand');
  const f = args[0];
  return [
    { type: 'output', text: `Opening ${f}...`, className: 'text-green-500/70' },
    { type: 'output', text: `(Simulated — try 'cat ${f}' to read it instead)`, className: 'text-yellow-400/80' },
  ];
}

/* ===================== Dispatcher ===================== */

function executeCommand(
  cmd: string,
  args: string[],
  cwd: string,
  fs: FSNode,
  stack: string[],
): HistoryEntry[] {
  switch (cmd) {
    case 'help':
      return helpCmd(args);
    case 'man':
      return manCmd(args);
    case 'ls':
      return lsCmd(args, cwd, fs);
    case 'pwd':
      return [{ type: 'output', text: cwd, className: 'text-green-500/70' }];
    case 'cat':
      return catCmd(args, cwd, fs);
    case 'mkdir':
      return mkdirCmd(args, cwd, fs);
    case 'touch':
      return touchCmd(args, cwd, fs);
    case 'rm':
      return rmCmd(args, cwd, fs);
    case 'tree':
      return treeCmd(args, cwd, fs);
    case 'echo':
      return [{ type: 'output', text: args.join(' '), className: 'text-green-300' }];
    case 'date':
      return [{ type: 'output', text: new Date().toString(), className: 'text-green-500/70' }];
    case 'whoami':
      return [{ type: 'output', text: 'moony', className: 'text-green-300' }];
    case 'hostname':
      return [{ type: 'output', text: 'dev', className: 'text-green-300' }];
    case 'uname':
      return unameCmd(args);
    case 'history':
      return historyCmd(args, stack);
    case 'neofetch':
      return neofetchCmd();
    case 'fortune':
      return [
        { type: 'output', text: FORTUNES[Math.floor(Math.random() * FORTUNES.length)], className: 'text-green-300' },
      ];
    case 'open':
      return openCmd(args);
    default:
      return errorText(`bash: ${cmd || ''}: command not found`);
  }
}

/* ===================== Component ===================== */

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
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() =>
    typeof window !== 'undefined'
      ? { x: Math.max(8, window.innerWidth - 560), y: 90 }
      : null,
  );

  const bootLinesRef = useRef<string[]>(DEFAULT_BOOT_LINES);
  const elRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const draggingRef = useRef(false);
  const offsetRef = useRef({ x: 0, y: 0 });
  const historyStackRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const prevCwdRef = useRef(HOME);
  const fsRef = useRef<FSNode>(FILE_SYSTEM);
  const dismissedRef = useRef(false);

  const promptText = `moony@dev:${cwd.replace(/^\/home\/moony/, '~')}`;

  function pushOutput(text: string, className = 'text-green-500/70') {
    setHistory((h) => [...h, { type: 'output', text, className }]);
  }

  // Boot animation: fetch network info, then type boot lines, then enable input.
  useEffect(() => {
    let isMounted = true;
    let lineTimer: ReturnType<typeof setInterval> | null = null;
    let bootTimer: ReturnType<typeof setTimeout> | null = null;

    async function fetchNetworkInfo() {
      try {
        const res = await fetch('/api/network');
        const data: NetworkInfo = await res.json();
        if (!isMounted) return;
        bootLinesRef.current = [
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
          'Type "help" to list available commands.',
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

    fetchNetworkInfo();

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
  }, [history, visibleLines, booted, cwd]);

  // Free dragging anywhere on screen (mouse + touch).
  useEffect(() => {
    function clamp(clientX: number, clientY: number) {
      const width = elRef.current?.offsetWidth ?? 520;
      const height = elRef.current?.offsetHeight ?? 360;
      const margin = 8;
      return {
        x: Math.max(
          margin,
          Math.min(clientX - offsetRef.current.x, window.innerWidth - width - margin),
        ),
        y: Math.max(
          margin,
          Math.min(clientY - offsetRef.current.y, window.innerHeight - height - margin),
        ),
      };
    }
    const move = (clientX: number, clientY: number) => {
      if (draggingRef.current) setPos(clamp(clientX, clientY));
    };
    const onMouseMove = (e: MouseEvent) => move(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      if (draggingRef.current) {
        e.preventDefault();
        move(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    const onUp = () => {
      draggingRef.current = false;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onUp);
    };
  }, []);

  function startDrag(clientX: number, clientY: number) {
    dismissedRef.current = true;
    const el = elRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    offsetRef.current = { x: clientX - rect.left, y: clientY - rect.top };
    setPos({ x: rect.left, y: rect.top });
    draggingRef.current = true;
  }

  function runCommand(raw: string) {
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

  function handleTab(e: KeyboardEvent<HTMLInputElement>) {
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
    // Path completion.
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
        onMouseDown={(e) => startDrag(e.clientX, e.clientY)}
        onTouchStart={(e) => startDrag(e.touches[0].clientX, e.touches[0].clientY)}
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
          moony@dev: ~/portfolio
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
      {/* Matrix rain, only inside the terminal window */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-10">
        {[...Array(24)].map((_, i) => (
          <span
            key={i}
            className="loader-matrix-char loader-matrix-char--window"
            style={{
              left: `${(i * 4.3) % 100}%`,
              animationDelay: `${(i * 0.5) % 4}s`,
              animationDuration: `${4 + (i % 5)}s`,
            }}
          >
            {MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)]}
          </span>
        ))}
      </div>

      {/* Draggable header with macOS traffic-light buttons */}
      <div
        onMouseDown={(e) => startDrag(e.clientX, e.clientY)}
        onTouchStart={(e) => startDrag(e.touches[0].clientX, e.touches[0].clientY)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderBottom: '1px solid rgba(34,197,94,0.2)',
          background: '#0d130d',
          // cursor: 'move',
          userSelect: 'none',
          touchAction: 'none',
          position: 'relative',
          zIndex: 10,
        }}
      >
        <button
          onClick={() => {
            dismissedRef.current = true;
            setIsVisible(false);
          }}
          title="Close"
          aria-label="Close terminal"
          className="w-3 h-3 rounded-full bg-red-500/80 hover:bg-red-500 transition-colors cursor-pointer"
          style={{ border: 'none', padding: 0, flexShrink: 0 }}
        />
        <button
          onClick={() => {
            dismissedRef.current = true;
            setMinimized(true);
          }}
          title="Minimize"
          aria-label="Minimize terminal"
          className="w-3 h-3 rounded-full bg-yellow-500/80 hover:bg-yellow-500 transition-colors cursor-pointer"
          style={{ border: 'none', padding: 0, flexShrink: 0 }}
        />
        <button
          onClick={() => setExpanded((s) => !s)}
          title={expanded ? 'Restore size' : 'Expand'}
          aria-label={expanded ? 'Restore terminal size' : 'Expand terminal'}
          className="w-3 h-3 rounded-full bg-green-500/80 hover:bg-green-500 transition-colors cursor-pointer"
          style={{ border: 'none', padding: 0, flexShrink: 0 }}
        />
        <span className="ml-2 text-xs text-green-500/60 font-mono flex-1">
          moony@dev: ~/portfolio
        </span>
      </div>

      {/* Terminal body — boot lines, then interactive prompt */}
      <div
        ref={scrollRef}
        onClick={() => {
          dismissedRef.current = true;
          inputRef.current?.focus();
        }}
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
        {!cleared &&
          bootLinesRef.current.slice(0, visibleLines).map((line, i) => (
            <div
              key={`boot-${i}`}
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
              {i === visibleLines - 1 && !booted && <span className="loader-cursor">▊</span>}
            </div>
          ))}

        {history.map((entry, i) => (
          <div key={`h-${i}`} className={entry.className ?? 'text-green-500/70'}>
            {entry.text}
          </div>
        ))}

        {booted && (
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-green-400 shrink-0 whitespace-nowrap">{promptText}$</span>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              aria-label="Terminal input"
              className="bg-transparent outline-none border-none text-green-300 flex-1 text-[13px] font-mono"
              style={{ caretColor: '#22c55e', minWidth: 0 }}
            />
            <span className="loader-cursor shrink-0">▊</span>
          </div>
        )}
      </div>
    </div>
  );
}