/**
 * Soft sine chimes for the celebration card. Nothing plays unless the learner turned sound on, and only
 * from the tap that saved the answer or round (browsers start audio only after a tap).
 */
export type ChimeNote = { frequency: number; start: number; duration: number; gain: number };

const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5;

export function chimeNotes(kind: "points" | "level-up"): ChimeNote[] {
  const notes = kind === "points" ? [E5, G5] : [C5, E5, G5, C6];
  const step = kind === "points" ? 0.12 : 0.13;
  return notes.map((frequency, index) => ({
    frequency,
    start: index * step,
    duration: index === notes.length - 1 ? 0.45 : 0.22,
    gain: 0.045,
  }));
}

let context: AudioContext | null = null;

/** Call inside the tap: creates or resumes the audio context so a chime can follow the server's reply. */
export function unlockChime(): void {
  if (typeof window === "undefined") return;
  try {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    context ??= new Context();
    if (context.state === "suspended") void context.resume();
  } catch {
    context = null;
  }
}

export function playChime(kind: "points" | "level-up"): void {
  if (!context) return;
  try {
    const begin = context.currentTime + 0.02;
    for (const note of chimeNotes(kind)) {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = note.frequency;
      envelope.gain.setValueAtTime(0.0001, begin + note.start);
      envelope.gain.exponentialRampToValueAtTime(note.gain, begin + note.start + 0.02);
      envelope.gain.exponentialRampToValueAtTime(0.0001, begin + note.start + note.duration);
      oscillator.connect(envelope).connect(context.destination);
      oscillator.start(begin + note.start);
      oscillator.stop(begin + note.start + note.duration + 0.02);
    }
  } catch {
    /* Sound is a nicety; the card already shows everything. */
  }
}
