#!/usr/bin/env python3
"""Checks that the student book does not expose the final mission's reference answer.

Each phrase below exists only in the teacher book (the reference record, the worked report, the rubric
band wording). The check fails if a phrase appears in the student PDF, or is missing from the teacher
PDF (which would mean the phrase list no longer matches the teacher book and must be updated).

usage: python qa_leak.py <student.pdf> <teacher.pdf> --out <dir>
"""
import argparse
import json
from pathlib import Path

import pymupdf as fitz  # PyMuPDF

PHRASES = [
    "期末參考紀錄",
    "-1,816",
    "253.5 跌破 254",
    "優秀報告的寫法",
    "評分示意",
    "一次例外且有說明",
    "算式小誤",
]


def text_of(pdf: str) -> str:
    with fitz.open(pdf) as doc:
        text = "\n".join(page.get_text() for page in doc)
    # The books print minus as U+2212; search both spellings as one.
    return text.replace("−", "-")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("student")
    parser.add_argument("teacher")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    student, teacher = text_of(args.student), text_of(args.teacher)
    items = [{"phrase": phrase, "student": phrase in student, "teacher": phrase in teacher} for phrase in PHRASES]
    ok = all(not item["student"] and item["teacher"] for item in items)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "leak-check.json").write_text(json.dumps({"ok": ok, "items": items}, ensure_ascii=False, indent=1), encoding="utf-8")
    for item in items:
        print(f"{item['phrase']}: student {'FOUND' if item['student'] else 'absent'} · teacher {'present' if item['teacher'] else 'MISSING'}")
    print("leak check passed" if ok else "LEAK CHECK FAILED")
    if not ok:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
