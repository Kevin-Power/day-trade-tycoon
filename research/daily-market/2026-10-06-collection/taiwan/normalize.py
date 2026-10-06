"""Normalize captured public source data without fetching or filling missing values."""
import hashlib
import json
import re
from datetime import datetime, timedelta
from html.parser import HTMLParser
from pathlib import Path

BASE = Path(__file__).resolve().parent
OUT = BASE / 'normalized'
OUT.mkdir(exist_ok=True)

def read(name):
    return json.loads((BASE / name).read_text(encoding='utf-8'))

def write(name, data):
    (OUT / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def number(value):
    text = str(value).replace(',', '').strip()
    if not re.fullmatch(r'-?\d+(?:\.\d+)?', text):
        raise ValueError(f'Not a number: {value!r}')
    return float(text) if '.' in text else int(text)

attempts = read('collection-attempts.json')['attempts'] + read('extra-attempts.json')['attempts'] + [read('night-attempt.json')]
sources = {a['id']: a for a in attempts}
for item in attempts:
    assert item.get('status') == 200, item['id']
    assert hashlib.sha256((BASE / item['filename']).read_bytes()).hexdigest() == item['sha256'], item['id']

class Rows(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell = [], None, None
    def handle_starttag(self, tag, attrs):
        if tag == 'tr': self.row = []
        if tag in ('td', 'th') and self.row is not None: self.cell = ''
    def handle_data(self, text):
        if self.cell is not None: self.cell += text
    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.row is not None and self.cell is not None:
            self.row.append(' '.join(self.cell.split()))
            self.cell = None
        if tag == 'tr' and self.row is not None:
            self.rows.append(self.row)
            self.row = None

def html_rows(source_id):
    raw = (BASE / sources[source_id]['filename']).read_text(encoding='utf-8')
    parser = Rows()
    parser.feed(raw)
    return raw, parser.rows

def futures_foreign(day):
    source_id = f'taifex-contracts-{day}'
    raw, rows = html_rows(source_id)
    date = f'{day[:4]}/{day[4:6]}/{day[6:]}'
    assert re.search(r'日期\s*' + re.escape(date), raw), 'Unexpected report date'
    index = next(i for i, row in enumerate(rows) if len(row) == 15 and row[1] == '臺股期貨')
    foreign = rows[index + 2]
    assert len(foreign) == 13 and foreign[0] == '外資'
    values = list(map(number, foreign[1:]))
    assert values[0] - values[2] == values[4]
    assert values[6] - values[8] == values[10]
    return {'sourceId': source_id, 'date': date.replace('/', '-'), 'product': 'TX', 'scope': '臺股期貨所有到期月份合計', 'unit': 'contracts', 'identity': foreign[0], 'longTradingContracts': values[0], 'shortTradingContracts': values[2], 'netTradingContracts': values[4], 'longOpenInterest': values[6], 'shortOpenInterest': values[8], 'netOpenInterest': values[10]}

foreign = read('raw/twse-foreign-20261005.json')
margin = read('raw/twse-margin-20261005.json')
daily = read('raw/twse-indexdaily-202610.json')
assert all(x['stat'] == 'OK' and x['date'] == '20261005' for x in (foreign, margin, daily))
assert foreign['fields'] == ['單位名稱', '買進金額', '賣出金額', '買賣差額']
foreign_rows = []
for row in foreign['data']:
    buy, sell, net = map(number, row[1:])
    assert buy - sell == net
    foreign_rows.append({'name': row[0], 'buy': buy, 'sell': sell, 'net': net, 'unit': 'TWD'})
foreign_cash = next(row for row in foreign_rows if row['name'] == '外資及陸資(不含外資自營商)')

margin_table = margin['tables'][0]
assert margin_table['fields'] == ['項目', '買進', '賣出', '現金(券)償還', '前日餘額', '今日餘額']
margin_rows = []
for row in margin_table['data']:
    values = list(map(number, row[1:]))
    margin_rows.append({'name': row[0], 'buy': values[0], 'sell': values[1], 'cashOrStockRepayment': values[2], 'previousBalanceAsReported': values[3], 'balanceAsReported': values[4], 'balanceChange': values[4] - values[3], 'unit': 'TWD_thousands' if '金額' in row[0] else 'source_trading_units'})

taiex_rows = [row for row in daily['data'] if row[0] == '115/10/05']
assert len(taiex_rows) == 1
taiex = taiex_rows[0]
futures = futures_foreign('20261005')
previous_futures = futures_foreign('20261002')
futures['previousObservation'] = previous_futures
futures['netOpenInterestChange'] = futures['netOpenInterest'] - previous_futures['netOpenInterest']
futures['changeMeaning'] = 'Delta in net outstanding contracts, separate from current-day net trading contracts.'

night_raw, night_rows = html_rows('taifex-night-20261006')
assert re.search(r'日期：\s*2026/10/06', night_raw)
assert '2026/10/05&nbsp;&nbsp;15:00~次日05:00 盤後交易時段行情表' in night_raw
night = next(row for row in night_rows if len(row) == 15 and row[:2] == ['TX', '202610'])
night_change = number(night[6].replace('▲', '').replace('▼', '-'))
previous_settlement = next(row for row in read('raw/taifex-market-latest.json') if row['Date'] == '20261005' and row['Contract'] == 'TX' and row['ContractMonth(Week)'] == '202610' and row['TradingSession'] == '一般')
assert number(night[5]) - number(previous_settlement['SettlementPrice']) == night_change
assert number(night[4]) <= min(number(night[2]), number(night[5])) <= max(number(night[2]), number(night[5])) <= number(night[3])

reference = {
    'lessonDate': '2026-10-06', 'contextDate': '2026-10-05', 'timezone': 'Asia/Taipei',
    'status': 'historical-reference-collected-not-integrated', 'strictPremarketEligible': False,
    'availableAt': None,
    'availabilityNote': 'Collected after the lesson date open. Public report dates are verified; first publication and historical revisions were not captured. Do not claim strict pre-open point-in-time approval.',
    'marketScope': 'TWSE listed-market cash and margin; TAIFEX TX futures, not combined listed-plus-OTC',
    'taiexPreviousSession': {'sourceId': 'twse-indexdaily-202610', 'date': '2026-10-05', 'close': number(taiex[4]), 'change': number(taiex[5]), 'unit': 'index_points', 'turnoverTWD': number(taiex[2])},
    'institutionalCash': {'sourceId': 'twse-foreign-20261005', 'date': '2026-10-05', 'foreignExcludingForeignDealers': foreign_cash, 'allRows': foreign_rows},
    'margin': {'sourceId': 'twse-margin-20261005', 'date': '2026-10-05', 'rows': margin_rows, 'revisionNote': 'TWSE notes next-day adjustments; current and previous balances are preserved as returned in this collection, not assumed original-release values.'},
    'foreignTxFutures': futures,
    'txNightSession': {'sourceId': 'taifex-night-20261006', 'reportTradingDate': '2026-10-06', 'sessionStart': '2026-10-05T15:00:00+08:00', 'sessionEnd': '2026-10-06T05:00:00+08:00', 'contract': 'TX', 'contractMonth': '202610', 'open': number(night[2]), 'high': number(night[3]), 'low': number(night[4]), 'last': number(night[5]), 'changeVsPriorSettlement': night_change, 'changePercentAsReported': night[7], 'priorSettlement': number(previous_settlement['SettlementPrice']), 'volumeContracts': number(night[8]), 'priceUnit': 'index_points', 'reportAvailableAt': None},
    'marginMaintenanceRatio': {'value': None, 'status': 'not-collected', 'reason': 'No matching dated source verified; do not substitute collateral maintenance of other financing products.'},
    'ema11': {'periods': 11, 'timeframe': None, 'priceBasis': None, 'values': None, 'status': 'awaiting-teacher-timeframe-definition'},
    'sources': list(sources.values()),
}
write('preopen-reference-2026-10-06.json', reference)

index_checks = []
for day in ('20261005', '20261006'):
    doc = read(f'raw/twse-index5s-{day}.json')
    date = f'{day[:4]}-{day[4:6]}-{day[6:]}'
    assert doc['stat'] == 'OK' and doc['date'] == day
    assert doc['fields'][0:2] == ['時間', '發行量加權股價指數']
    selected = [{'timestamp': f'{date}T{row[0]}+08:00', 'value': number(row[1])} for row in doc['data'] if '09:00:00' <= row[0] <= '10:00:00']
    assert len(selected) == 721
    for index, point in enumerate(selected):
        assert datetime.fromisoformat(point['timestamp']) == datetime.fromisoformat(f'{date}T09:00:00+08:00') + timedelta(seconds=5*index)
    write(f'taiex-5s-{date}-0900-1000.json', {'sourceId': f'twse-index5s-{day}', 'date': date, 'intervalSeconds': 5, 'endpointRule': '09:00 and 10:00 both included; source timestamps preserved', 'meaning': 'Official TAIEX observations; not individual-stock trades or synthetic stock paths', 'points': selected})
    index_checks.append({'date': date, 'rawRows': len(doc['data']), 'selectedPoints': len(selected), 'gridSeconds': 5, 'passed': True})

write('validation.json', {'passed': True, 'rawHashCount': len(attempts), 'cashBuyMinusSellChecks': len(foreign_rows), 'futuresNetArithmeticPassed': True, 'nightPriorSettlementComparisonPassed': True, 'nightSessionDatePassed': True, 'dailyContextRowSelection': 'Only 2026-10-05 selected; raw month report also contains 2026-10-06 and is not served to learners', 'indexChecks': index_checks, 'meaning': 'Structural and arithmetic checks; not source accuracy, rights, or historical point-in-time certification.'})
print(json.dumps({'passed': True, 'filesWritten': 4, 'foreignCashTWD': foreign_cash['net'], 'foreignTxNetOI': futures['netOpenInterest'], 'foreignTxNetOIChange': futures['netOpenInterestChange'], 'nightLast': number(night[5]), 'indexChecks': index_checks}, ensure_ascii=False))
