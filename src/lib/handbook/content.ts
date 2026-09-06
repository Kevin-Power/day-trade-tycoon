import type {
  CostChapter,
  Glossary,
  MistakesChapter,
  PlansChapter,
  PrinciplesChapter,
  StartChapter,
  WorksheetChapter,
} from "@/lib/handbook/types";
import { GLOSSARY } from "@/lib/handbook/glossary";
import { START } from "@/lib/handbook/start";
import { COST } from "@/lib/handbook/cost";
import { PRINCIPLE_NOTES } from "@/lib/handbook/principles";
import { MISTAKES } from "@/lib/handbook/mistakes";
import { PLANS } from "@/lib/handbook/plans";
import { WORKSHEET } from "@/lib/handbook/worksheet";

/**
 * 教材內容。
 *
 * 課綱、六式與費率不放這裡 —— 教材頁直接讀 `curriculum.ts`、`scenarios.ts`
 * 與 `ticks.ts`，避免講義跟盤面各講各的。這裡只放教材自己的散文。
 *
 * 每一章都是選填：還沒寫完的章節就不會出現在教材裡，不會擋住其他章。
 */
export type HandbookContent = {
  start?: StartChapter;
  cost?: CostChapter;
  principles?: PrinciplesChapter;
  glossary: Glossary;
  mistakes?: MistakesChapter;
  plans?: PlansChapter;
  worksheet?: WorksheetChapter;
};

export const HANDBOOK: HandbookContent = {
  start: START,
  cost: COST,
  principles: PRINCIPLE_NOTES,
  glossary: GLOSSARY,
  mistakes: MISTAKES,
  plans: PLANS,
  worksheet: WORKSHEET,
};
