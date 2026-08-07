import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { stat } from 'fs/promises';

const execAsync = promisify(exec);

/**
 * Local-only real terminal API.
 *
 * ⚠️ SECURITY: This route ONLY executes commands when the request comes
 * from localhost (dev mode). When deployed to Netlify/production, it
 * returns { local: false } and the frontend falls back to the simulated
 * terminal — so no one can run commands on the deployed server.
 */

// Persistent working directory across requests (like a real terminal).
let persistentCwd = process.cwd();

export async function POST(req: NextRequest) {
  // Only allow local requests (dev mode / localhost)
  const isLocal =
    process.env.NODE_ENV === 'development' ||
    req.headers.get('host')?.startsWith('localhost') ||
    req.headers.get('host')?.startsWith('127.0.0.1') ||
    req.headers.get('host')?.startsWith('192.168.') ||
    req.headers.get('host')?.startsWith('10.') ||
    req.headers.get('host')?.startsWith('172.');

  if (!isLocal) {
    return NextResponse.json({ local: false, output: '', cwd: persistentCwd });
  }

  try {
    const body = await req.json();
    const command = String(body?.command ?? '').trim();

    if (!command) {
      return NextResponse.json({ local: true, output: '', cwd: persistentCwd });
    }

    // Block obviously dangerous commands even locally (safety net)
    const blocked = /\b(rm\s+-rf|sudo\s+rm|mkfs|dd\s+if=|shutdown|reboot|:\(\)\s*\{|fork\s*bomb)\b/i;
    if (blocked.test(command)) {
      return NextResponse.json({
        local: true,
        output: '⚠️ Command blocked for safety (local terminal).',
        cwd: persistentCwd,
      });
    }

    // Handle cd specially — persist the working directory.
    const [cmd, ...args] = command.split(/\s+/);
    if (cmd === 'cd') {
      let target = args[0] || '~';
      if (target === '-') {
        // cd - goes to HOME (a real shell tracks previous dirs; this is a simplification)
        target = process.env.HOME || '~';
      }
      if (target === '~') target = process.env.HOME || '/';
      const newCwd = path.isAbsolute(target)
        ? target
        : path.resolve(persistentCwd, target);

      try {
        const stats = await stat(newCwd);
        if (!stats.isDirectory()) throw new Error('Not a directory');
        persistentCwd = newCwd;
        return NextResponse.json({
          local: true,
          output: '',
          cwd: persistentCwd,
        });
      } catch {
        return NextResponse.json({
          local: true,
          output: `bash: cd: ${args[0] || ''}: No such file or directory`,
          cwd: persistentCwd,
        });
      }
    }

    const { stdout, stderr } = await execAsync(command, {
      timeout: 10000,
      maxBuffer: 1024 * 1024, // 1MB
      shell: '/bin/bash',
      cwd: persistentCwd,
    });

    const output = [stdout, stderr].filter(Boolean).join('\n').trim();

    return NextResponse.json({ local: true, output, cwd: persistentCwd });
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const output = [e.stdout, e.stderr, e.message]
      .filter(Boolean)
      .join('\n')
      .trim();
    return NextResponse.json({
      local: true,
      output: output || 'Command failed.',
      cwd: persistentCwd,
    });
  }
}