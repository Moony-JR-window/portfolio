"use client";

/**
 * Messenger-style sound effects synthesized with the Web Audio API.
 * No binary audio assets required.
 *
 * Sounds:
 * - playTypeSound(): short "keyboard pop" on each keystroke.
 * - playSendSound():  quick "whoosh + chime" when you send a message.
 * - playIncomingTypingSound(): soft ping when someone else starts typing.
 * - playIncomingMessageSound(): tone when you receive a message.
 *
 * A single module-level AudioContext and muted flag are shared so both the
 * chat UI (outgoing sounds) and the socket hook (incoming sounds) stay in sync.
 */

let ctx: AudioContext | null = null;
let muted = false;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;

  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;

  if (!ctx) ctx = new Ctor();
  // Browsers only allow audio after a user gesture; resume if suspended.
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

/** Build a simple tone envelope and schedule it on the context. */
function tone(
  context: AudioContext,
  startAt: number,
  frequency: number,
  peak: number,
  duration: number
): void {
  const osc = context.createOscillator();
  const gain = context.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(frequency, startAt);
  osc.frequency.exponentialRampToValueAtTime(
    Math.max(frequency * 0.7, 1),
    startAt + duration
  );

  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  osc.connect(gain);
  gain.connect(context.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

function play(fn: (context: AudioContext, now: number) => void): void {
  if (muted) return;
  try {
    const context = getCtx();
    if (!context) return;
    fn(context, context.currentTime);
  } catch {
    // Swallow errors; sound is a non-critical enhancement.
  }
}

/** Your own keystrokes. */
export function playTypeSound(): void {
  play((c, now) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.03);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  });
}

/** Your message was sent (whoosh + soft chime). */
export function playSendSound(): void {
  play((c, now) => {
    tone(c, now, 600, 0.08, 0.12);
    tone(c, now + 0.06, 880, 0.06, 0.1);
  });
}

/** Someone else started typing — soft, unobtrusive double tap. */
export function playIncomingTypingSound(): void {
  play((c, now) => {
    tone(c, now, 620, 0.045, 0.05);
    tone(c, now + 0.07, 800, 0.035, 0.05);
  });
}

/** Received a new message — gentle two-note chime. */
export function playIncomingMessageSound(): void {
  play((c, now) => {
    tone(c, now, 660, 0.055, 0.09);
    tone(c, now + 0.1, 990, 0.055, 0.12);
  });
}

/** Check if sounds are muted. */
export function isSoundMuted(): boolean {
  return muted;
}

/** Set the shared muted flag; returns the new value. */
export function setSoundMuted(m: boolean): boolean {
  muted = m;
  return muted;
}

/**
 * React hook wrapper exposing the sound triggers and a toggle that keeps
 * things in sync with the shared module-level muted flag.
 */
export function useMessageSounds() {
  return {
    playType: playTypeSound,
    playSend: playSendSound,
    playIncomingTyping: playIncomingTypingSound,
    playIncomingMessage: playIncomingMessageSound,
    isMuted: isSoundMuted,
    toggleMuted: () => setSoundMuted(!muted),
  };
}