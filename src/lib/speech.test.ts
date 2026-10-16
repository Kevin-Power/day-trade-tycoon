import test from "node:test";
import assert from "node:assert/strict";
import { fillAnnouncement, pickChineseVoice, speak, SPEECH_TEXT, speechSupported } from "./speech.ts";

test("a fill is read with name, side, lots and plain price", () => {
  assert.equal(fillAnnouncement({ side: "buy", shares: 1000, price: 2580 }, "台積電"), "你的委託成交：台積電，買進 1 張，2580 元");
  assert.equal(fillAnnouncement({ side: "sell", shares: 2000, price: 98.5 }, "鴻海"), "你的委託成交：鴻海，賣出 2 張，98.5 元");
});

test("Taiwan Mandarin is preferred, any Chinese voice is accepted, none means unsupported", () => {
  assert.equal(pickChineseVoice([{ lang: "en-US" }, { lang: "zh-CN" }, { lang: "zh-TW" }])?.lang, "zh-TW");
  assert.equal(pickChineseVoice([{ lang: "zh_TW" }, { lang: "zh-CN" }])?.lang, "zh_TW");
  assert.equal(pickChineseVoice([{ lang: "zh-HK" }])?.lang, "zh-HK");
  assert.equal(pickChineseVoice([{ lang: "en-US" }]), null);
  assert.equal(speechSupported({ getVoices: () => [{ lang: "en-US" }] as SpeechSynthesisVoice[] }), false);
  assert.equal(speechSupported({ getVoices: () => [{ lang: "zh-TW" }] as SpeechSynthesisVoice[] }), true);
  assert.equal(speechSupported(undefined), false);
});

test("speaking cancels what is being read first", () => {
  const calls: string[] = [];
  const synth = {
    getVoices: () => [],
    cancel: () => calls.push("cancel"),
    speak: (utterance: { text: string; rate: number; lang: string }) =>
      calls.push(`speak:${utterance.text}:${utterance.rate}:${utterance.lang}`),
  };
  speak("你好", synth as never, (text) => ({ text, rate: 1, lang: "" }) as never);
  assert.deepEqual(calls, ["cancel", "speak:你好:0.9:zh-TW"]);
  assert.doesNotThrow(() => speak("你好", undefined, (text) => ({ text }) as never));
});

test("start and finish lines are fixed", () => {
  assert.deepEqual(SPEECH_TEXT, { start: "練習開始，現在是早上九點。", finish: "這一輪已經保存，辛苦了。" });
});
