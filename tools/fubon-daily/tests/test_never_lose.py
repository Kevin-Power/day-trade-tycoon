"""Randomized check that no answer Fubon gives for today's trades is ever lost: three runs a day, each stock
getting, at random in each run, a whole, short, cut, cut-at-the-last-page, rejected, failed or missing answer."""
import gzip
import json
import random
import unittest
from datetime import datetime
from unittest import mock

from fubon_daily.client import ApiError, NotFound
from fubon_daily.normalize import TAIPEI
from tests.fixtures import DATE, full_day, quote, snapshot, trade
from tests.test_pipeline import FakeClient, PipelineHarness

RUNS = (datetime(2026, 10, 15, 16, 45, tzinfo=TAIPEI), datetime(2026, 10, 15, 18, 0, tzinfo=TAIPEI),
        datetime(2026, 10, 15, 19, 0, tzinfo=TAIPEI))
ANSWERS = ("whole", "short", "cut", "cut-last-page", "rejected")  # Fubon sends at least one page
OUTCOMES = ANSWERS + ("failed", "missing")
CODES = tuple(str(1100 + n) for n in range(8))
SCENARIOS = 25


def answer(run: int, count: int = 5, bad: bool = False) -> list:
    """Five 1-lot trades make the day's volume; the bid marks which run the answer came from."""
    return [trade(DATE, 9, 0, n, 50, 1, n + 1, volume=n + 1 + (1 if bad and n == 1 else 0), bid=run + 1)
            for n in range(count)]


def fake_fubon(run: int, plan: dict, first: bool) -> FakeClient:
    trades, errors = {}, {}
    for code, outcome in plan.items():
        if outcome in ("whole", "cut", "cut-last-page"):
            trades[code] = answer(run)
        elif outcome == "short":
            trades[code] = answer(run, count=3)
        elif outcome == "rejected":
            trades[code] = answer(run, bad=True)
        if outcome == "cut":  # the page at offset 2 fails three times: 2 of the 5 trades are fetched
            errors[(code, 2)] = [ApiError("500", 500)] * 3
        elif outcome == "cut-last-page":  # every trade is fetched, then the closing empty page fails
            errors[(code, 5)] = [ApiError("500", 500)] * 3
        elif outcome == "failed":
            errors[code] = [ApiError("500", 500)] * 3
        elif outcome == "missing":
            errors[code] = NotFound("404", 404)
    items = [quote(code, f"股{n}", 50, 0, 5, 10_000_000 - n) for n, code in enumerate(CODES)]
    minutes = {code: full_day(code, price=50) for code in CODES} if first else None
    return FakeClient(snapshot_payload=snapshot(items=items), minutes=minutes, trades=trades, trade_errors=errors)


class NeverLoseTest(PipelineHarness, unittest.TestCase):
    def test_every_answer_fubon_gives_is_published_exactly_once(self):
        rng = random.Random(20261021)
        for scenario in range(SCENARIOS):
            plans = [{code: rng.choice(OUTCOMES) for code in CODES} for _ in RUNS]
            with self.subTest(scenario=scenario, plans=plans):
                self.tearDown()
                self.setUp()
                given = {code: [] for code in CODES}  # the runs whose answer Fubon gave, per stock
                whole = set()
                with mock.patch("fubon_daily.ticks.TRADE_PAGE_SIZE", 2):
                    for run, (at, plan) in enumerate(zip(RUNS, plans)):
                        if (self.data / "ticks" / DATE).exists():
                            break
                        fubon = fake_fubon(run, plan, first=run == 0)
                        self.run_once(fubon, at=at)
                        for call in fubon.calls:
                            if isinstance(call, tuple) and call[0] == "trades" and call[2] == 0 \
                                    and plan[call[1]] in ANSWERS:
                                given[call[1]].append(run)
                                if plan[call[1]] == "whole":
                                    whole.add(call[1])
                folder = self.data / "ticks" / DATE
                if not (folder / "manifest.json").is_file():
                    self.assertEqual([runs for runs in given.values() if runs], [])  # nothing was ever given
                    continue
                manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
                published = {code: [] for code in CODES}
                for item in manifest["files"]:
                    path = item["path"]
                    if path.startswith("raw/") or (path.startswith("fallback/") and path.endswith(".json.gz")):
                        pages = json.loads(gzip.decompress((folder / path).read_bytes()))
                        published[path.split("/")[1].split(".")[0]].append(pages[0]["data"][0]["bid"] - 1)
                for code in CODES:
                    self.assertEqual(sorted(published[code]), sorted(given[code]), code)
                complete = {entry["code"] for entry in manifest["symbols"] if entry["complete"]}
                self.assertLessEqual(complete, whole)
                self.assertFalse((self.data / "staging-ticks" / DATE).exists())


if __name__ == "__main__":
    unittest.main()
