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
    tick_warnings,
    trade_rows,
)
from tests.fixtures import (DATE, DISPOSITION, daily, full_day, quote, row, snapshot, sparse_day, trade,
                            trades_page)


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


def opening_pages():
    return [
        trades_page("2330", DATE, [trade(DATE, 9, 0, 0, 2420, 6446, 11, volume=6446, bid=2415, ask=2420),
                                   trade(DATE, 9, 0, 1, 2425, 3, 12, volume=6449, bid=2420, ask=2425, ms=250)]),
        trades_page("2330", DATE, [trade(DATE, 13, 30, 0, 2440, 5833, 90, volume=12282)]),
    ]


class TradeRowsTest(unittest.TestCase):
    def assertKind(self, pages, kind, symbol="2330"):
        with self.assertRaises(ValidationError) as caught:
            trade_rows(pages, symbol, DATE)
        self.assertEqual(caught.exception.kind, kind)

    def with_row(self, **changes):
        pages = opening_pages()
        pages[0]["data"][1].update(changes)
        return pages

    def test_pages_become_trades_in_milliseconds_after_nine(self):
        self.assertEqual(trade_rows(opening_pages(), "2330", DATE), [
            [0, 2420, 6446, 2415, 2420],
            [1250, 2425, 3, 2420, 2425],
            [16_200_000, 2440, 5833, None, None],
        ])

    def test_no_pages_is_no_trades(self):
        self.assertEqual(trade_rows([], "2330", DATE), [])

    def test_structure_errors(self):
        self.assertKind(["x"], "structure")
        self.assertKind([trades_page("2317", DATE, [])], "structure")
        self.assertKind([{"symbol": "2330", "date": DATE, "data": {}}], "structure")
        self.assertKind([trades_page("2330", DATE, ["x"])], "structure")

    def test_another_day_is_rejected(self):
        self.assertKind([trades_page("2330", "2026-10-14", [])], "time")
        self.assertKind([trades_page("2330", DATE, [trade("2026-10-14", 10, 0, 0, 100, 1, 1)])], "time")

    def test_trades_outside_the_session_are_rejected(self):
        self.assertKind([trades_page("2330", DATE, [trade(DATE, 8, 59, 59, 100, 1, 1)])], "time")
        self.assertKind([trades_page("2330", DATE, [trade(DATE, 13, 31, 0, 100, 1, 1)])], "time")
        self.assertKind(self.with_row(time="09:00:01"), "time")

    def test_prices_and_sizes_are_checked(self):
        self.assertKind(self.with_row(price=0), "price")
        self.assertKind(self.with_row(price="2425"), "price")
        self.assertKind(self.with_row(bid=-1), "price")
        self.assertKind(self.with_row(size=0), "volume")
        self.assertKind(self.with_row(size=1.5), "volume")
        self.assertKind(self.with_row(size=True), "volume")

    def test_a_missing_quote_side_is_none(self):
        trades = trade_rows(self.with_row(ask=0, bid=None), "2330", DATE)
        self.assertEqual(trades[1][3:], [None, None])

    def test_repeated_or_backward_trades_are_rejected(self):
        self.assertKind(self.with_row(serial=11), "order")
        pages = opening_pages()
        pages[1]["data"][0]["time"] = pages[0]["data"][1]["time"] - 1
        self.assertKind(pages, "order")

    def test_running_volume_must_add_up(self):
        self.assertKind(self.with_row(volume=6450), "volume")


class TickWarningsTest(unittest.TestCase):
    def test_trades_matching_the_snapshot_have_no_warnings(self):
        trades = trade_rows(opening_pages(), "2330", DATE)
        self.assertEqual(tick_warnings("2330", trades, 12282, 2440), [])

    def test_volume_and_close_mismatches_are_warnings(self):
        trades = trade_rows(opening_pages(), "2330", DATE)
        kinds = [warning["kind"] for warning in tick_warnings("2330", trades, 12283, 2435)]
        self.assertEqual(kinds, ["volume", "close"])


if __name__ == "__main__":
    unittest.main()
