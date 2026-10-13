export type ReplaySpeed = 1 | 2;

/** Milliseconds between automatic one-minute advances; 2x equals the server's one-second floor. */
export const REPLAY_DELAY: Record<ReplaySpeed, number> = { 1: 2000, 2: 1000 };
