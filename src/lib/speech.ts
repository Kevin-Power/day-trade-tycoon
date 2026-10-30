import type { MorningFill } from "./morning.ts";
import { fillPriceText } from "./morning-ledger.ts";

/** Optional read-aloud with the device's built-in voices. Market moves are never read out. */
export type SpeechLike = Pick<SpeechSynthesis, "getVoices" | "cancel" | "speak">;

export const SPEECH_TEXT = {
  start: "練習開始，現在是早上九點。",
  finish: "這一輪已經保存，辛苦了。",
  enabled: "朗讀提示已開啟。",
};

const normal = (lang: string) => lang.replace("_", "-").toLowerCase();

export function pickChineseVoice<T extends { lang: string }>(voices: readonly T[]): T | null {
  return (
    voices.find((voice) => normal(voice.lang) === "zh-tw") ??
    voices.find((voice) => normal(voice.lang).startsWith("zh")) ??
    null
  );
}

export function speechSupported(synth: Pick<SpeechSynthesis, "getVoices"> | undefined): boolean {
  try {
    return Boolean(synth && pickChineseVoice(synth.getVoices()));
  } catch {
    return false;
  }
}

/** `interrupt: false` queues the line after the one being read instead of cutting it off. */
export function speak(
  text: string,
  synth: SpeechLike | undefined,
  makeUtterance: (text: string) => SpeechSynthesisUtterance,
  interrupt = true,
): void {
  if (!synth) return;
  if (interrupt) synth.cancel();
  const utterance = makeUtterance(text);
  utterance.lang = "zh-TW";
  utterance.rate = 0.9;
  const voice = pickChineseVoice(synth.getVoices());
  if (voice) utterance.voice = voice;
  synth.speak(utterance);
}

/**
 * The price is the one the desk shows (fillPriceText: an average off the tick grid to two decimals, never the raw
 * floating number), read without trailing zeros: 「20.58 元」, 「1462.5 元」, 「30 元」.
 */
export function fillAnnouncement(fill: Pick<MorningFill, "side" | "shares" | "price">, name: string): string {
  const price = Number.isFinite(fill.price) ? String(Number(fillPriceText(fill.price))) : "--";
  return `你的委託成交：${name}，${fill.side === "buy" ? "買進" : "賣出"} ${fill.shares / 1000} 張，${price} 元`;
}
