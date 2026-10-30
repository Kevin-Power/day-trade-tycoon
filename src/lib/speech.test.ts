import test from "node:test";
import assert from "node:assert/strict";
import { fillAnnouncement, pickChineseVoice, speak, SPEECH_TEXT, speechSupported } from "./speech.ts";

test("a fill is read with name, side, lots and plain price", () => {
  assert.equal(fillAnnouncement({ side: "buy", shares: 1000, price: 2580 }, "台積電"), "你的委託成交：台積電，買進 1 張，2580 元");
  assert.equal(fillAnnouncement({ side: "sell", shares: 2000, price: 98.5 }, "鴻海"), "你的委託成交：鴻海，賣出 2 張，98.5 元");
});

test("a fill made of several trades is read at its average to two decimals, never the raw number", () => {
  assert.equal(
    fillAnnouncement({ side: "buy", shares: 400_000, price: 20.577125000000006 }, "東元"),
    "你的委託成交：東元，買進 400 張，20.58 元",
  );
  assert.equal(fillAnnouncement({ side: "buy", shares: 4000, price: 302 / 3 }, "鴻海"), "你的委託成交：鴻海，買進 4 張，100.67 元");
  // An average off a 1,000+ stock's grid keeps its half, and is not read as 1463.
  assert.equal(fillAnnouncement({ side: "sell", shares: 2000, price: 1462.5 }, "台積電"), "你的委託成交：台積電，賣出 2 張，1462.5 元");
  // Trailing zeros are not read out: 30 is 「30 元」, not 「30.00 元」.
  assert.equal(fillAnnouncement({ side: "buy", shares: 1000, price: 30 }, "長榮航"), "你的委託成交：長榮航，買進 1 張，30 元");
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
  assert.equal(SPEECH_TEXT.start, "練習開始，現在是早上九點。");
  assert.equal(SPEECH_TEXT.finish, "這一輪已經保存，辛苦了。");
});

test("a queued line does not cut off the one being read", () => {
  const calls: string[] = [];
  const synth = { getVoices: () => [], cancel: () => calls.push("cancel"), speak: (u: { text: string }) => calls.push(`speak:${u.text}`) };
  speak("第二句", synth as never, (text) => ({ text }) as never, false);
  assert.deepEqual(calls, ["speak:第二句"]);
});

test("turning read-aloud on is confirmed out loud", () => {
  assert.equal(SPEECH_TEXT.enabled, "朗讀提示已開啟。");
});
