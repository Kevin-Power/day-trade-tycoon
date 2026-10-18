import { create } from "zustand";
import { browserStorage, readDeviceValue, writeDeviceValue } from "./device-storage.ts";

export type ReadingMode = "standard" | "senior";
const STORAGE_KEY = "day-tycoon-display-v1";
const SPEECH_KEY = "day-tycoon-speech-v1";
const SOUND_KEY = "day-tycoon-sound-v1";

/** Read-aloud starts off; no stored answer means the learner has not been asked yet. */
export function readSpeechPreference(storage: Pick<Storage, "getItem"> | undefined): { speech: boolean; asked: boolean } {
  const value = readDeviceValue(storage, SPEECH_KEY);
  return { speech: value === "on", asked: value === "on" || value === "off" };
}
export function writeSpeechPreference(storage: Pick<Storage, "setItem" | "removeItem"> | undefined, on: boolean): void {
  writeDeviceValue(storage, SPEECH_KEY, on ? "on" : "off");
}

/** Celebration sound starts off: a room full of phones should stay quiet unless a learner asks for it. */
export function readSoundPreference(storage: Pick<Storage, "getItem"> | undefined): boolean {
  return readDeviceValue(storage, SOUND_KEY) === "on";
}
export function writeSoundPreference(storage: Pick<Storage, "setItem" | "removeItem"> | undefined, on: boolean): void {
  writeDeviceValue(storage, SOUND_KEY, on ? "on" : "off");
}

type DisplayPreferences = {
  mode: ReadingMode;
  speech: boolean;
  speechAsked: boolean;
  sound: boolean;
  hydrated: boolean;
  hydrate: () => void;
  setMode: (mode: ReadingMode) => void;
  setSpeech: (on: boolean) => void;
  setSound: (on: boolean) => void;
};

export const useDisplayPreferences = create<DisplayPreferences>((set) => ({
  mode: "standard",
  speech: false,
  speechAsked: false,
  sound: false,
  hydrated: false,
  hydrate: () => {
    const storage = browserStorage();
    const mode: ReadingMode = readDeviceValue(storage, STORAGE_KEY) === "senior" ? "senior" : "standard";
    const { speech, asked } = readSpeechPreference(storage);
    set({ mode, speech, speechAsked: asked, sound: readSoundPreference(storage), hydrated: true });
  },
  setMode: (mode) => {
    set({ mode });
    writeDeviceValue(browserStorage(), STORAGE_KEY, mode);
  },
  setSpeech: (on) => {
    set({ speech: on, speechAsked: true });
    writeSpeechPreference(browserStorage(), on);
  },
  setSound: (on) => {
    set({ sound: on });
    writeSoundPreference(browserStorage(), on);
  },
}));
