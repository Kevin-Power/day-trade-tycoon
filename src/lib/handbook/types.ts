/**
 * 教材的資料型別。
 *
 * 教材與盤面共用同一份課綱（`src/lib/game/curriculum.ts`）與同一組費率常數
 * （`src/lib/market/ticks.ts`），所以講義上的數字不會跟學員螢幕上的兜不起來。
 * 這裡只放教材自己的散文內容。
 */

export type GlossaryTerm = {
  term: string;
  /** 英文或代號；沒有就是空字串。 */
  en: string;
  oneLine: string;
  /** 在盤面哪裡看到它：面板、欄位、線的顏色。 */
  where: string;
  /** 新手最常誤解成什麼。 */
  misread: string;
};

export type GlossaryGroup = { group: string; terms: GlossaryTerm[] };
export type Glossary = { intro: string; groups: GlossaryGroup[] };

export type Rate = { label: string; value: string; note: string };

export type Worked = {
  title: string;
  setup: string;
  steps: string[];
  answer: string;
};

export type BreakevenRow = {
  price: string;
  tick: string;
  cost: string;
  ticksToBreakeven: string;
};

export type CostChapter = {
  intro: string;
  rates: Rate[];
  worked: Worked[];
  breakeven: BreakevenRow[];
  takeaway: string;
};

export type StartChapter = {
  whatIsDaytrade: string;
  rules: Rate[];
  risk: string[];
  classroomBoundary: string[];
  firstDay: string[];
};

export type PrincipleNote = {
  /** 與 curriculum.ts 的 PRINCIPLES 編號一致。 */
  no: string;
  title: string;
  why: string;
  howToSee: string;
  wrongLooks: string;
  drill: string;
};

export type PrinciplesChapter = { intro: string; items: PrincipleNote[] };

export type Mistake = {
  name: string;
  symptom: string;
  why: string;
  /** 違反六式的第幾式。 */
  principle: string;
  fix: string;
};

export type MistakesChapter = { intro: string; items: Mistake[] };

export type PlanStep = { at: string; doWhat: string; sayWhat: string };

export type LessonPlan = {
  /** 與 curriculum.ts 的 LESSONS id 一致。 */
  id: string;
  no: string;
  skill: string;
  goal: string;
  board: string[];
  openQuestion: string;
  timeline: PlanStep[];
  watchFor: string[];
  closeQuestion: string;
};

export type PlansChapter = { intro: string; lessons: LessonPlan[] };

export type FormField = { label: string; hint: string; lines: number };

export type WorksheetChapter = {
  intro: string;
  planTitle: string;
  planIntro: string;
  planFields: FormField[];
  reviewTitle: string;
  reviewIntro: string;
  reviewFields: FormField[];
  checklist: string[];
};
