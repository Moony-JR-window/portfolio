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
 *
 * Supports two execution modes:
 *  - local: commands run directly on the host machine (macOS/Linux)
 *  - docker: commands run inside a persistent Linux container (shares host kernel)
 */

// Persistent working directory across requests (like a real terminal).
let persistentCwd = process.cwd();

// Docker container for Linux execution mode.
const DOCKER_IMAGE = process.env.TERMINAL_DOCKER_IMAGE || 'ubuntu:latest';
let dockerContainerId: string | null = null;
let dockerAvailable: boolean | null = null;
let dockerChecked = false;

async function checkDocker(): Promise<boolean> {
  if (dockerChecked) return dockerAvailable === true;
  dockerChecked = true;
  try {
    const { stdout } = await execAsync('docker --version && docker info --format "{{.ServerVersion}}"', {
      timeout: 5000,
      shell: '/bin/bash',
    });
    dockerAvailable = stdout.length > 0;
  } catch {
    dockerAvailable = false;
  }
  return dockerAvailable;
}

async function ensureDockerContainer(): Promise<string | null> {
  if (!(await checkDocker())) return null;

  if (dockerContainerId) {
    // Check if container still exists and is running
    try {
      const { stdout } = await execAsync(
        `docker ps -q -f id=${dockerContainerId} 2>/dev/null`,
        { timeout: 3000, shell: '/bin/bash' },
      );
      if (stdout.trim()) return dockerContainerId;
    } catch {
      // fall through — recreate
    }
  }

  try {
    // Create a persistent container (don't remove after exit so cwd persists)
    const { stdout } = await execAsync(
      `docker run -d --name moony-terminal \
        -v "${process.cwd()}:/workspace" \
        -w /workspace \
        ${DOCKER_IMAGE} sleep infinity`,
      { timeout: 15000, shell: '/bin/bash' },
    );
    dockerContainerId = stdout.trim();
    return dockerContainerId;
  } catch {
    // Name conflict — try to start existing container
    try {
      const { stdout } = await execAsync(
        'docker ps -aq -f name=moony-terminal | head -1',
        { timeout: 3000, shell: '/bin/bash' },
      );
      if (stdout.trim()) {
        dockerContainerId = stdout.trim();
        await execAsync(`docker start ${dockerContainerId}`, { timeout: 8000, shell: '/bin/bash' });
        return dockerContainerId;
      }
    } catch {
      dockerAvailable = false;
    }
    return null;
  }
}

/** Run a command in the given mode, returning { output, cwd }. */
async function runInMode(
  command: string,
  mode: 'local' | 'docker',
  currentCwd: string,
): Promise<{ output: string; cwd: string }> {
  if (mode === 'docker') {
    const container = await ensureDockerContainer();
    if (!container) {
      return {
        output: '⚠️ Docker not available. Use "~mode local" to run locally.',
        cwd: currentCwd,
      };
    }

    // cd within container: use `sh -c "cd <dir> && pwd"` to persist via workdir
    if (command.startsWith('cd ')) {
      const target = command.slice(3).trim() || '/workspace';
      const execOut = await execAsync(
        `docker exec ${container} sh -c "cd '${target}' 2>/dev/null && pwd"`,
        { timeout: 5000, shell: '/bin/bash' },
      );
      const newCwd = execOut.stdout.trim();
      if (newCwd) {
        return { output: '', cwd: newCwd };
      }
      return {
        output: `bash: cd: ${target}: No such file or directory`,
        cwd: currentCwd,
      };
    }

    // Run inside container with persistent cwd via `sh -c`
    const { stdout, stderr } = await execAsync(
      `docker exec -w '${currentCwd}' ${container} /bin/bash -c "cd '${currentCwd}' && ${command}"`,
      {
        timeout: 10000,
        maxBuffer: 1024 * 1024,
        shell: '/bin/bash',
      },
    );
    const output = [stdout, stderr].filter(Boolean).join('\n').trim();
    return { output, cwd: currentCwd };
  }

  // ==== LOCAL MODE ====
  // Handle cd specially — persist the working directory.
  if (command.startsWith('cd ')) {
    let target = command.slice(3).trim() || '~';
    if (target === '~') target = process.env.HOME || '/';
    const newCwd = path.isAbsolute(target)
      ? target
      : path.resolve(currentCwd, target);

    try {
      const stats = await stat(newCwd);
      if (!stats.isDirectory()) throw new Error('Not a directory');
      return { output: '', cwd: newCwd };
    } catch {
      return {
        output: `bash: cd: ${command.slice(3).trim()}: No such file or directory`,
        cwd: currentCwd,
      };
    }
  }

  const { stdout, stderr } = await execAsync(command, {
    timeout: 10000,
    maxBuffer: 1024 * 1024, // 1MB
    shell: '/bin/bash',
    cwd: currentCwd,
  });

  const output = [stdout, stderr].filter(Boolean).join('\n').trim();
  return { output, cwd: currentCwd };
}

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
    return NextResponse.json({
      local: false,
      output: '',
      cwd: persistentCwd,
      mode: 'local',
      docker: false,
    });
  }

  try {
    const body = await req.json();
    const command = String(body?.command ?? '').trim();
    const requestedMode = String(body?.mode ?? 'autodetect');

    // Determine effective mode
    let mode: 'local' | 'docker' = 'local';
    if (requestedMode === 'docker') {
      mode = 'docker';
    } else if (requestedMode.toLowerCase() === 'autodetect') {
      const docker = await checkDocker();
      if (docker && process.env.TERMINAL_FORCE_DOCKER === 'true') {
        mode = 'docker';
      }
    }

    if (!command) {
      return NextResponse.json({
        local: true,
        output: '',
        cwd: persistentCwd,
        mode,
        docker: await checkDocker(),
      });
    }

    // Block obviously dangerous commands even locally (safety net)
    const blocked = /\b(rm\s+-rf|sudo\s+rm|mkfs|dd\s+if=|shutdown|reboot|:\(\)\s*\{|fork\s*bomb)\b/i;
    if (blocked.test(command)) {
      return NextResponse.json({
        local: true,
        output: '⚠️ Command blocked for safety (local terminal).',
        cwd: persistentCwd,
        mode,
        docker: await checkDocker(),
      });
    }

    // Handle ~mode (switch execution environment)
    if (command === '~mode') {
      const docker = await checkDocker();
      return NextResponse.json({
        local: true,
        output: docker
          ? 'Docker detected! Use "~docker on" to run in Linux container, "~docker off" for local.'
          : 'Docker not detected. Running in local mode (macOS/Linux host shell).',
        cwd: persistentCwd,
        mode,
        docker,
      });
    }

    if (command === '~docker on') {
      const docker = await checkDocker();
      if (!docker) {
        return NextResponse.json({
          local: true,
          output: '⚠️ Docker is not installed or not running on this machine.',
          cwd: persistentCwd,
          mode: 'local',
          docker: false,
        });
      }
      const container = await ensureDockerContainer();
      if (container) {
        persistentCwd = '/workspace';
        return NextResponse.json({
          local: true,
          output: '✅ Linux container active (Ubuntu). Commands now run inside Docker.',
          cwd: '/workspace',
          mode: 'docker',
          docker: true,
        });
      }
      return NextResponse.json({
        local: true,
        output: '⚠️ Failed to start Docker container.',
        cwd: persistentCwd,
        mode: 'local',
        docker: true,
      });
    }

    if (command === '~docker off') {
      return NextResponse.json({
        local: true,
        output: 'Switched to local mode. Commands run on host machine.',
        cwd: persistentCwd,
        mode: 'local',
        docker: true,
      });
    }

    const result = await runInMode(command, mode, persistentCwd);

    // Sync persistent cwd (the dir operations happen in the requested mode's namespace)
    if (result.cwd) persistentCwd = result.cwd;

    return NextResponse.json({
      local: true,
      output: result.output,
      cwd: result.cwd,
      mode,
      docker: await checkDocker(),
    });
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
      mode: 'local',
      docker: dockerAvailable === true,
    });
  }
}