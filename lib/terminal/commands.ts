import type { FSNode, HistoryEntry } from './types';
import { resolvePath, getNode, countDirs, countFiles, treeLines } from './file-system';

export const COMMANDS = [
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

const errorText = (text: string): HistoryEntry[] => [
  { type: 'output', text, className: 'text-red-400' },
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

export function executeCommand(
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