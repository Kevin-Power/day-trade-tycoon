import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AUX_CLASSROOM_SIM,
  AUX_FROZEN,
  AUX_NOT_LIVE,
  BADGE_CLASSROOM,
  BADGE_OFFICIAL,
  BLOTTER_NOTE,
  CLASSROOM_SHORT,
  COACH_CORNER,
  CONSENT,
  DISCLAIMER,
  DISCLOSURE_ROWS,
  SIM_CHIP_NOTE,
  TEACHING_WEEK_RANGE,
  blotterMicro,
  classroomBookMicro,
  classroomInnerOuterMicro,
  classroomPathMicro,
  classroomSampleMicro,
  classroomTapeMicro,
  freezeWeekLabel,
  officialDailyOhlcMicro,
  officialIndexMicro,
  officialIndexPaneMicro,
  officialMisMicro,
  officialTurnoverMicro,
  officialWatchlistMicro,
} from "./provenance.ts";

describe("provenance copy", () => {
  it("allows only the two primary badges", () => {
    assert.equal(BADGE_OFFICIAL, "官方");
    assert.equal(BADGE_CLASSROOM, "教室生成");
    const kinds = new Set(DISCLOSURE_ROWS.filter((r) => r.kind !== "全域").map((r) => r.kind));
    assert.deepEqual([...kinds].sort(), [BADGE_CLASSROOM, BADGE_OFFICIAL].sort());
  });

  it("does not claim every quote is merely historical or delayed", () => {
    assert.equal(
      DISCLAIMER,
      "本站為模擬教學環境。加權指數等標「官方」的欄位來自證交所／櫃買公開資料（可能延遲或教材凍結）。標「教室生成」的個股分時、五檔、明細是教學投影，不是逐筆行情。模擬績效不代表實盤，不構成投資建議或勸誘。",
    );
    assert.equal(DISCLAIMER.includes("所有行情為歷史或延遲"), false);
    assert.equal(CONSENT.includes("官方與教室生成"), true);
  });

  it("keeps the coach corner line and sim-chip note", () => {
    assert.equal(COACH_CORNER, "這是證交所 5 秒指數。個股盤中用大盤節奏投影，沒有官方 1 分 K。");
    assert.equal(SIM_CHIP_NOTE, "指數可為官方；個股盤中多為教室生成");
    assert.equal(CLASSROOM_SHORT, "教室生成 · 非逐筆 · 僅教學");
    assert.equal(BLOTTER_NOTE, "模擬通路 · 券商 API 未接線");
    assert.equal(AUX_FROZEN, "教材凍結");
    assert.equal(AUX_CLASSROOM_SIM, "CLASSROOM-SIM");
    assert.equal(AUX_NOT_LIVE, "非即時快照");
  });

  it("builds widget micros from the spec table", () => {
    assert.equal(officialIndexMicro("09:00:05"), "官方 · TWSE MI_5MINS · as-of 09:00:05");
    assert.equal(officialTurnoverMicro("2026-08-26"), "官方 · TWSE FMTQIK · as-of 2026-08-26");
    assert.equal(
      officialIndexPaneMicro("09:00:05", "2026-08-26"),
      "官方 · TWSE MI_5MINS · as-of 09:00:05 · 官方 · TWSE FMTQIK · as-of 2026-08-26",
    );
    assert.equal(
      officialDailyOhlcMicro(TEACHING_WEEK_RANGE),
      "官方日K · TWSE MI_INDEX / TPEx dailyQuotes · 教材週 2026-08-24～08-26",
    );
    assert.equal(
      officialWatchlistMicro(TEACHING_WEEK_RANGE),
      "官方 · TWSE/TPEx ISIN 核對 · 教材週 2026-08-24～08-26",
    );
    assert.equal(classroomPathMicro(), "教室生成 · 大盤節奏投影 · 無官方 1 分 K");
    assert.equal(classroomBookMicro(), "教室生成 · 教學五檔 · 非撮合現場逐筆");
    assert.equal(classroomTapeMicro(), "教室生成 · 非官方 tick");
    assert.equal(classroomInnerOuterMicro(), "教室生成 · 由模擬路徑推估");
    assert.equal(officialMisMicro("08:45:00"), "官方快照 · TWSE MIS · 非即時 · as-of 08:45:00");
    assert.equal(classroomSampleMicro(3), "教室樣本 · n=3 · 不可外推實盤");
    assert.equal(blotterMicro(), "CLASSROOM-SIM · 模擬通路 · 券商 API 未接線");
  });

  it("uses the teaching week unless a live-practice date is given", () => {
    assert.equal(freezeWeekLabel(), TEACHING_WEEK_RANGE);
    assert.equal(freezeWeekLabel("2026-08-24"), TEACHING_WEEK_RANGE);
    assert.equal(freezeWeekLabel("2026-09-01"), "2026-09-01");
  });
});
