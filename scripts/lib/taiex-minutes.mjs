// TAIEX minute bars for the lessons, from TWSE's official 5-second index file (MI_5MINS_INDEX).
// Shared by both lesson generators. Plain ESM, no dependencies.
//
// TWSE's 09:00:00 row repeats the previous session's close before the first computed value, so it is a
// placeholder, not the index: minute i is built only from the twelve points after its start, up to and
// including its end ((i·60, i·60+60] seconds after 09:00). Open = the first of them (09:00:05 for the
// first minute), close = the last, high/low = their extremes. Each bar keeps its twelve points (`p`) so the
// desk can replay the minute with real values.

const STEP = 5;
const POINTS_PER_MINUTE = 60 / STEP;

const seconds = (time) => {
  const match = /^(\d{2}):(\d{2}):(\d{2})$/.exec(time);
  if (!match) throw new Error(`大盤時間格式不正確：${time}`);
  const [, h, m, s] = match.map(Number);
  return h * 3600 + m * 60 + s - 9 * 3600;
};

/** The weighted index (發行量加權股價指數) at every 5-second time stamp of the file. */
export function parseTwseIndex5s(raw) {
  const fields = raw?.fields;
  const rows = raw?.data;
  if (!Array.isArray(fields) || !Array.isArray(rows)) throw new Error("大盤檔案缺少 fields 或 data");
  const timeColumn = fields.indexOf("時間");
  const valueColumn = fields.indexOf("發行量加權股價指數");
  if (timeColumn < 0 || valueColumn < 0) throw new Error("大盤檔案沒有「時間」或「發行量加權股價指數」欄");
  return rows.map((row) => {
    const value = Number(String(row[valueColumn]).replaceAll(",", ""));
    if (!Number.isFinite(value) || value <= 0) throw new Error(`大盤數值不正確：${row[timeColumn]} ${row[valueColumn]}`);
    return { time: String(row[timeColumn]), value };
  });
}

/** `minutes` one-minute bars from 09:00, each from its twelve real 5-second points. */
export function taiexMinuteBars(points, { previousClose, minutes }) {
  if (!Array.isArray(points) || !points.length) throw new Error("沒有大盤資料");
  const times = points.map((point) => seconds(point.time));
  if (times[0] !== 0) throw new Error(`大盤第一點應為 09:00:00，實際是 ${points[0].time}`);
  if (points[0].value !== previousClose)
    throw new Error(`09:00:00 應是前一日收盤的佔位值 ${previousClose}，實際是 ${points[0].value}`);
  times.forEach((time, index) => {
    if (time !== index * STEP) throw new Error(`大盤資料不連續：第 ${index} 點是 ${points[index].time}`);
  });
  const bars = [];
  for (let minute = 0; minute < minutes; minute += 1) {
    const start = minute * 60;
    const p = points.filter((_, index) => times[index] > start && times[index] <= start + 60).map((point) => point.value);
    if (p.length !== POINTS_PER_MINUTE)
      throw new Error(`大盤第 ${minute} 分鐘應有 ${POINTS_PER_MINUTE} 點，實際 ${p.length} 點`);
    bars.push({ t: start, o: p[0], h: Math.max(...p), l: Math.min(...p), c: p.at(-1), p });
  }
  return bars;
}
