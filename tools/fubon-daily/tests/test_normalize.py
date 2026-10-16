import copy
import unittest

from fubon_daily.normalize import (
    CLOSING_AUCTION_T,
    ValidationError,
    daily_summary,
    disposition_codes,
    minute_bars,
    reference_price,
    snapshot_listing,
    symbol_warnings,
)
from tests.fixtures import DATE, DISPOSITION, daily, full_day, quote, row, snapshot, sparse_day


class MinuteBarsTest(unittest.TestCase):
    def assertKind(self, payload, kind, symbol="2330"):
        with self.assertRaises(ValidationError) as caught:
            minute_bars(payload, symbol, DATE)
        self.assertEqual(caught.exception.kind, kind)

    def test_full_day_has_266_bars_ending_with_the_closing_auction(self):
        bars = minute_bars(full_day(), "2330", DATE)
        self.assertEqual(len(bars), 266)
        self.assertEqual(bars[0], [0, 100.0, 100.0, 100.0, 100.0, 10, 100.0])
        self.assertEqual(bars[-1][0], CLOSING_AUCTION_T)

    def test_sparse_day_without_a_closing_bar_is_valid(self):
        bars = minute_bars(sparse_day(), "1413", DATE)
        self.assertEqual([bar[0] for bar in bars], [660, 12900, 15120])

    def test_empty_data_is_valid_and_empty(self):
        self.assertEqual(minute_bars({"symbol": "2330", "data": []}, "2330", DATE), [])

    def test_structure_errors(self):
        self.assertKind([], "structure")
        self.assertKind({**full_day(), "symbol": "2317"}, "structure")
        self.assertKind({"symbol": "2330", "data": {}}, "structure")
        self.assertKind({"symbol": "2330", "data": ["x"]}, "structure")

    def test_time_errors(self):
        for bad in ("not a time", "2026-10-15T09:00:00.000+00:00", "2026-10-14T09:00:00.000+08:00",
                    "2026-10-15T13:27:00.000+08:00", "2026-10-15T08:59:00.000+08:00",
                    "2026-10-15T09:00:30.000+08:00"):
            payload = full_day()
            payload["data"][0]["date"] = bad
            self.assertKind(payload, "time")

    def test_order_errors(self):
        duplicate = full_day()
        duplicate["data"].insert(1, copy.deepcopy(duplicate["data"][0]))
        self.assertKind(duplicate, "order")
        backwards = full_day()
        backwards["data"].reverse()
        self.assertKind(backwards, "order")

    def test_price_errors(self):
        low_above_close = full_day()
        low_above_close["data"][0]["low"] = 101.0
        self.assertKind(low_above_close, "price")
        zero = full_day()
        zero["data"][0]["open"] = 0
        self.assertKind(zero, "price")

    def test_volume_and_average_errors(self):
        for field, value, kind in (("volume", 1.5, "volume"), ("volume", -1, "volume"), ("volume", True, "volume"),
                                   ("average", None, "average"), ("average", 0, "average")):
            payload = full_day()
            payload["data"][0][field] = value
            self.assertKind(payload, kind)


class SnapshotAndDailyTest(unittest.TestCase):
    def test_snapshot_listing_keeps_untraded_stocks_with_zero_volume(self):
        date, listings = snapshot_listing(snapshot())
        self.assertEqual(date, DATE)
        self.assertEqual([item.code for item in listings], ["2330", "1413", "9999"])
        self.assertEqual(listings[0].name, "台積電")
        self.assertIsNone(listings[2].close)
        self.assertEqual(listings[2].trade_volume, 0)

    def test_snapshot_volume_none_counts_as_zero(self):
        _, listings = snapshot_listing(snapshot(items=[quote("1101", "台泥", None, 0, None, None)]))
        self.assertEqual((listings[0].trade_volume, listings[0].trade_value), (0, 0))

    def test_bad_snapshot_is_a_structure_error(self):
        for bad in (None, {"date": DATE}, {"date": 1, "data": []}, {"date": DATE, "data": [{"symbol": 1}]}):
            with self.assertRaises(ValidationError):
                snapshot_listing(bad)

    def test_reference_price_is_close_minus_change(self):
        self.assertEqual(reference_price(27.3, 0.5), 26.8)
        self.assertEqual(reference_price(2440, -50), 2490)
        self.assertIsNone(reference_price(None, 1))

    def test_disposition_codes(self):
        self.assertEqual(disposition_codes(DISPOSITION), {"2424"})
        with self.assertRaises(ValidationError):
            disposition_codes({"data": "x"})

    def test_daily_summary_converts_shares_to_lots(self):
        self.assertEqual(daily_summary(daily("2330"), "2330", DATE),
                         {"close": 100.0, "change": 1.0, "tradeVolume": 1234, "tradeValue": 123_400_000})
        self.assertIsNone(daily_summary({"symbol": "2330", "data": []}, "2330", DATE))
        self.assertIsNone(daily_summary(daily("2330", date="2026-10-14"), "2330", DATE))


class WarningsTest(unittest.TestCase):
    def test_consistent_symbol_has_no_warnings(self):
        bars = minute_bars(full_day(price=2440), "2330", DATE)
        self.assertEqual(symbol_warnings("2330", bars, 58487, 2440), [])

    def test_volume_above_snapshot_and_close_mismatch_are_warnings(self):
        bars = minute_bars(full_day(price=2440), "2330", DATE)
        kinds = [warning["kind"] for warning in symbol_warnings("2330", bars, 10, 2435)]
        self.assertEqual(kinds, ["volume", "close"])


if __name__ == "__main__":
    unittest.main()
