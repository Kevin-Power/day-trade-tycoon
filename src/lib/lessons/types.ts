// Types shared by the lessons' server and browser code. Types only: nothing here may import runtime code.

/** The 當沖 list the fetcher stored for a day (radar/<date>.json): code and name per stock, as the sheet had them. */
export type RadarList = { date: string; symbols: { code: string; name: string }[] };
