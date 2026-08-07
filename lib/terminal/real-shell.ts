/**
 * Client-side helper for the local-only real terminal.
 *
 * Detects whether the real shell API is available (local dev mode).
 * When deployed (Netlify), the API returns { local: false } and the
 * terminal falls back to the simulated virtual file system.
 *
 * Supports two execution modes:
 *  - local: commands run on the host machine (macOS/Linux)
 *  - docker: commands run inside a persistent Linux container (Ubuntu)
 */

let realShellAvailable: boolean | null = null;

export type ShellMode = 'local' | 'docker';

export interface RealShellResult {
  local: boolean;
  output: string;
  cwd: string;
  mode: ShellMode;
  docker: boolean;
}

function emptyResult(): RealShellResult {
  return { local: false, output: '', cwd: '', mode: 'local', docker: false };
}

/** Check once whether the real shell is available (cached). */
export async function isRealShellAvailable(): Promise<boolean> {
  if (realShellAvailable !== null) return realShellAvailable;

  try {
    const res = await fetch('/api/terminal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'echo __REAL_SHELL_OK__' }),
    });
    const data: RealShellResult = await res.json();
    realShellAvailable = data.local === true;
  } catch {
    realShellAvailable = false;
  }

  return realShellAvailable;
}

/** Execute a real command via the local API. Returns the full result. */
export async function runRealCommand(command: string): Promise<RealShellResult> {
  try {
    const res = await fetch('/api/terminal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });
    return (await res.json()) as RealShellResult;
  } catch {
    return emptyResult();
  }
}

/** Switch execution mode via the API (~docker on / ~docker off / ~mode). */
export async function setShellMode(command: string): Promise<RealShellResult> {
  try {
    const res = await fetch('/api/terminal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });
    const data = (await res.json()) as RealShellResult;
    // Update cached availability if the API says local is available
    if (data.local) realShellAvailable = true;
    return data;
  } catch {
    return emptyResult();
  }
}