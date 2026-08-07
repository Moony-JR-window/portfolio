import type { FSNode } from './types';

export const HOME = '/home/moony';

export const FILE_SYSTEM: FSNode = {
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
                      content:
                        '{\n  "name": "portfolio",\n  "version": "1.0.0",\n  ' +
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
export function resolvePath(cwd: string, raw: string): string {
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

export function getNode(fs: FSNode, path: string): FSNode | null {
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

export function countDirs(n: FSNode): number {
  if (n.type !== 'dir' || !n.children) return 0;
  return 1 + Object.values(n.children).reduce((acc, c) => acc + countDirs(c), 0);
}

export function countFiles(n: FSNode): number {
  if (n.type === 'file') return 1;
  if (!n.children) return 0;
  return Object.values(n.children).reduce((acc, c) => acc + countFiles(c), 0);
}

export function treeLines(n: FSNode, prefix: string): string[] {
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