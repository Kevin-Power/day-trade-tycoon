export type TrialQuestionStage = "review" | "waiting" | "closed";
export type TrialStage = TrialQuestionStage | "filled" | "complete";
export type TrialAnswerResult = "unanswered" | "hint" | "correct";

export type TrialPractice = {
  stage: TrialStage;
  /** Prompts shown during this round; never a skill score or a saved learner record. */
  hintedTopics: readonly TrialQuestionStage[];
  restartedFrom: TrialQuestionStage | null;
};

type TrialAction =
  | { type: "answer"; stage: TrialQuestionStage; choice: string }
  | { type: "close-position" }
  | { type: "retry-topic"; stage: TrialQuestionStage }
  | { type: "restart" };

const CORRECT_ANSWERS: Record<TrialQuestionStage, string> = {
  review: "lot",
  waiting: "check",
  closed: "loss",
};

const NEXT_STAGE: Record<TrialQuestionStage, TrialStage> = {
  review: "waiting",
  waiting: "filled",
  closed: "complete",
};

export function initialTrialPractice(): TrialPractice {
  return { stage: "review", hintedTopics: [], restartedFrom: null };
}

export function evaluateTrialAnswer(stage: TrialQuestionStage, choice: string): TrialAnswerResult {
  if (!choice) return "unanswered";
  return choice === CORRECT_ANSWERS[stage] ? "correct" : "hint";
}

/** All trial progress belongs to this mounted page, with no storage or account side effects. */
export function trialPracticeReducer(state: TrialPractice, action: TrialAction): TrialPractice {
  if (action.type === "restart") return initialTrialPractice();
  if (action.type === "retry-topic") {
    if (state.stage !== "complete" || !state.hintedTopics.includes(action.stage)) return state;
    return { ...state, stage: action.stage, restartedFrom: action.stage };
  }
  if (action.type === "close-position") {
    return state.stage === "filled" ? { ...state, stage: "closed" } : state;
  }
  if (state.stage !== action.stage) return state;
  const result = evaluateTrialAnswer(action.stage, action.choice);
  if (result === "unanswered") return state;
  if (result === "hint") {
    return state.hintedTopics.includes(action.stage)
      ? state
      : { ...state, hintedTopics: [...state.hintedTopics, action.stage] };
  }
  return { ...state, stage: NEXT_STAGE[action.stage] };
}
