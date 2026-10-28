// Types shared by the lessons' server and browser code. Types only: nothing here may import runtime code.

/** The 當沖 list the fetcher stored for a day (radar/<date>.json): code and name per stock, as the sheet had them. */
export type RadarList = { date: string; symbols: { code: string; name: string }[] };

/** One stock in a lesson day's picker: only what is known before 09:00 that day (③ decision P). */
export type PickerSymbol = { code: string; name: string; referencePrice: number; previousValue: number | null; disposition: boolean };

/** A lesson day's stock picker: its practisable stocks by code and the default 自選 with the desk wording for it. */
export type LessonPicker = {
  lessonId: string;
  date: string;
  symbols: PickerSymbol[];
  defaults: string[];
  note: { title: string; detail: string | null };
  booksAvailable: boolean;
  taiexAvailable: boolean;
};
