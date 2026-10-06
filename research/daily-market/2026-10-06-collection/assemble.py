"""Validate the saved collection and build an index/checksum inventory, without network."""
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

BASE = Path(__file__).resolve().parent

def read(name):
    return json.loads((BASE / name).read_text(encoding='utf-8'))

def sha(name):
    return hashlib.sha256((BASE / name).read_bytes()).hexdigest()

main = read('intraday/normalized/2026-10-06/manifest.json')
backup = read('intraday/normalized/2026-10-05/manifest.json')
us = read('us-indices/manifest.json')
taiwan = read('taiwan/normalized/preopen-reference-2026-10-06.json')
prices = read('intraday/cross-check/twse-2026-10-06-report.json')
video = read('video/sources.json')

for day, manifest in [('2026-10-06', main), ('2026-10-05', backup)]:
    folder = f'intraday/normalized/{day}'
    assert manifest['allStructuralChecksPassed'] and manifest['totalBars'] == 300
    assert sha(f'{folder}/bars.json') == manifest['combinedJsonSha256']
    bars = read(f'{folder}/bars.json')
    for stock in manifest['symbols']:
        assert sha('intraday/' + stock['rawFile']) == stock['rawSha256']
        assert sha(f"{folder}/{stock['csvFile']}") == stock['csvSha256']
        selected = [bar for bar in bars if bar['symbol'] == stock['symbol']]
        assert len(selected) == 60
        assert len({bar['timestampUnixSeconds'] for bar in selected}) == 60
        for bar in selected:
            assert bar['date'] == day
            assert datetime.fromisoformat(bar['replayAvailableAt']).timestamp() == bar['timestampUnixSeconds'] + 60
            assert bar['low'] <= min(bar['open'], bar['close']) <= max(bar['open'], bar['close']) <= bar['high']
assert prices['allPriceRangesConsistent'] and prices['allOpeningPricesMatch'] and prices['completedSymbols'] == 5
assert all(series['lastDate'] == '2026-10-05' and series['validCount'] == 67 for series in us['series'])
assert taiwan['contextDate'] == '2026-10-05' and taiwan['lessonDate'] == '2026-10-06'
assert read('taiwan/normalized/validation.json')['passed']
assert video['targetLessonDate'] == '2026-10-06' and video.get('targetLessonVideo') is None

component_paths = {
    'primaryStockMinuteBars': 'intraday/normalized/2026-10-06/bars.json',
    'primaryStockManifest': 'intraday/normalized/2026-10-06/manifest.json',
    'backupStockMinuteBars': 'intraday/normalized/2026-10-05/bars.json',
    'officialDailyPriceCrossCheck': 'intraday/cross-check/twse-2026-10-06-report.json',
    'usDailyObservations': 'us-indices/observations.json',
    'usSourceManifest': 'us-indices/manifest.json',
    'taiwanHistoricalBackground': 'taiwan/normalized/preopen-reference-2026-10-06.json',
    'officialTaiexFiveSecondSeries': 'taiwan/normalized/taiex-5s-2026-10-06-0900-1000.json',
    'videoSourceIndex': 'video/sources.json',
}
index = {
    'schemaVersion': 1, 'builtAt': datetime.now(timezone.utc).isoformat(),
    'collectionDate': '2026-10-06', 'primaryPracticeDate': '2026-10-06', 'backgroundDate': '2026-10-05',
    'timezone': 'Asia/Taipei', 'status': 'research-data-collected-not-a-published-course',
    'dataCollectionReadyForInspection': True, 'readyForLearnerDistribution': False,
    'websiteIntegrated': False, 'strictPremarketAvailabilityVerified': False,
    'locallySynthesizedPrices': False, 'tickDataCollected': False,
    'window': {'startInclusive': '2026-10-06T09:00:00+08:00', 'endExclusive': '2026-10-06T10:00:00+08:00', 'minuteBars': 300},
    'stocks': [{'code': code, 'name': name, 'selection': 'technical-data-validation-candidate-not-teacher-recommendation'} for code, name in [('2330', '台積電'), ('2317', '鴻海'), ('2454', '聯發科'), ('2382', '廣達'), ('2308', '台達電')]],
    'emaReference': {'indicator': 'EMA', 'periods': 11, 'timeframe': None, 'priceBasis': None, 'calculated': False},
    'targetLessonVideo': None,
    'teacherIdentityCandidate': video['identityCandidate'],
    'components': {key: {'path': value, 'sha256': sha(value)} for key, value in component_paths.items()},
    'unresolved': [
        'No verified same-day Boge premarket episode, transcript, or teacher-selected stock list.',
        'Minute OHLC does not reveal tick order; 09:00 volume is zero in the source for all five stocks and remains unverified.',
        'Background publication vintages were not captured; two FRED source updates occur after the 09:00 lesson cutoff.',
        'Margin maintenance ratio has no verified matching source in this collection.',
        'EMA11 timeframe/price basis and complete N-pattern teaching rules remain undefined.',
        'Public classroom display and redistribution scope has not been confirmed.',
        'Minute replay integration and server-side progressive disclosure have not been implemented.',
    ],
}
(BASE / 'lesson-data-index.json').write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

files = sorted(path for path in BASE.rglob('*') if path.is_file() and '__pycache__' not in path.parts and path != BASE / 'checksums.sha256')
for path in files:
    if path.suffix == '.json': json.loads(path.read_text(encoding='utf-8'))
    if path.suffix == '.md':
        for target in re.findall(r'\]\(([^\s)]+)\)', path.read_text(encoding='utf-8')):
            if '://' not in target and not target.startswith('#'):
                assert (path.parent / target.split('#')[0]).exists(), (str(path), target)
inventory = '\n'.join(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.relative_to(BASE).as_posix()}' for path in files) + '\n'
(BASE / 'checksums.sha256').write_text(inventory, encoding='utf-8')
print(json.dumps({'passed': True, 'filesChecksummed': len(files), 'primaryMinuteBars': 300, 'backupMinuteBars': 300, 'usValidValues': 268, 'independentDailyPriceCheck': True, 'localMarkdownLinks': 'passed'}, ensure_ascii=False))
