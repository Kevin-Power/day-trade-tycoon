import assert from "node:assert/strict";
import test from "node:test";
import { parseLotsDraft, parsePriceDraft, validateTicketDraft } from "./ticket-draft.ts";

test("quantity drafts accept only a completed integer within the existing lot range", () => {
  for (const value of ["", " ", "0", "-1", "1.5", "1.", "201", "1e2", "Infinity", "NaN", "+1"])
    assert.equal(parseLotsDraft(value), null, value);
  for (const [value, expected] of [["1", 1], [" 2 ", 2], ["200", 200], ["01", 1]] as const)
    assert.equal(parseLotsDraft(value), expected);
});

test("price drafts keep incomplete decimals invalid without replacing them with a prior price", () => {
  for (const value of ["", " ", ".", "100.", "0", "-1", "1e2", "Infinity", "NaN", "9".repeat(400)])
    assert.equal(parsePriceDraft(value), null, value);
  for (const [value, expected] of [["100", 100], ["100.5", 100.5], [".5", 0.5], [" 10.05 ", 10.05]] as const)
    assert.equal(parsePriceDraft(value), expected);
});

test("market orders do not require a limit price, but every mode requires a valid quantity", () => {
  assert.equal(validateTicketDraft({ lots: "1", price: "" }, "limit").ok, false);
  assert.deepEqual(validateTicketDraft({ lots: "1", price: "" }, "market"), { ok: true, lots: 1, price: null });
  assert.equal(validateTicketDraft({ lots: "", price: "100" }, "limit").ok, false);
  assert.equal(validateTicketDraft({ lots: "", price: "100" }, "market").ok, false);
});
