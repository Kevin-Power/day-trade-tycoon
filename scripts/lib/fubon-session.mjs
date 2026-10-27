// Metadata-only evidence for a dedicated, read-only broker session. This is not
// production HTTP/UI acceptance. Raw prices/books stay in memory for comparison.
export const DEFAULT_SYMBOLS = ['2330', '2317', '6488'];
export const POLICY = Object.freeze({ maxPollGapMs: 2500, maxClockDriftMs: 2000,
  maxRecoveryMs: 60000, maxQuietMs: 120000, freshMs: 15000, minChanges: 2 });
const taipeiDate = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
const at = (date, time) => Date.parse(`${date}T${time}:00+08:00`);
export function sessionWindow(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || taipeiDate(at(date, '09:00')) !== date) throw new Error('INVALID_DATE');
  return { date, prepare: at(date, '08:55'), open: at(date, '09:00'), auction: at(date, '13:25'),
    close: at(date, '13:30'), stop: at(date, '13:35'), reconnect: at(date, '10:30') };
}
const counts = () => ({ wsData: 0, wsSnapshot: 0, restSnapshot: 0, sourceUnavailable: 0,
  acceptedWsData: 0, newTrades: 0, bookChanges: 0, trial: 0, warming: 0, rejected: 0, staleSource: 0, duplicateOrOld: 0 });
const positive = n => Number.isFinite(n) && n > 0;
const stamp = n => Number.isSafeInteger(n) && n >= 1e15;
const serial = n => Number.isSafeInteger(n) && n >= 0 ? n : null;
const signature = d => JSON.stringify([d.bids, d.asks]);

export class SessionEvidence {
  constructor({ date, symbols = DEFAULT_SYMBOLS, startedWall, startedMono, emit = () => {} }) {
    this.window = sessionWindow(date); this.symbols = [...symbols]; this.startedWall = startedWall;
    this.startedMono = startedMono; this.emit = emit; this.minutes = new Map(); this.baselines = new Map();
    this.totals = Object.fromEntries(symbols.map(s => [s, counts()])); this.lastAdvance = new Map();
    this.lastAccepted = new Map(); this.maxQuiet = Object.fromEntries(symbols.map(s => [s, { trades: 0, books: 0 }]));
    this.transitions = []; this.previousState = ''; this.previousPoll = null; this.maxPollGapMs = 0;
    this.maxClockDriftMs = 0; this.injection = null; this.errors = new Set(); this.issues = {};
    this.protocolCounts = {}; this.protocolErrors = {};
    this.unplannedDisconnects = 0; this.lastFlushed = -Infinity;
  }
  minute(wall) {
    if (wall < this.window.open || wall >= this.window.close) return null;
    const key = Math.floor((wall - this.window.open) / 60000);
    if (!this.minutes.has(key)) this.minutes.set(key, { index: key, at: new Date(this.window.open + key * 60000).toISOString(),
      seen: new Set(), connected: new Set(), planned: new Set(), subscriptionsMin: 6, subscriptionsMax: 0,
      samples: 0, pollGapMs: 0, clockDriftMs: 0, generations: new Set(), states: new Set(),
      symbols: Object.fromEntries(this.symbols.map(s => [s, { counts: counts(), acknowledged: new Set(),
        tradeFresh: new Set(), bookFresh: new Set(), issue: new Set() }])) });
    return this.minutes.get(key);
  }
  isPlanned(wall) { return this.injection && wall >= this.injection.wall && wall <= (this.injection.recoveredWall ?? this.injection.wall + POLICY.maxRecoveryMs); }
  count(symbol, field, wall) { this.totals[symbol][field]++; const m = this.minute(wall); if (m) m.symbols[symbol].counts[field]++; }
  observe({ epoch, message, result, row, wall, mono }) {
    if (['pulse', 'heartbeat', 'state', 'quote', 'ack', 'unack', 'symbol_error', 'fault', 'fatal', 'bounds'].includes(message?.kind)) {
      this.protocolCounts[message.kind] = (this.protocolCounts[message.kind] ?? 0) + 1;
      if (['ack', 'unack', 'symbol_error', 'fault', 'fatal'].includes(message.kind)) {
        const event = { type: 'protocol', kind: message.kind, epoch, at: new Date(wall).toISOString() };
        if (this.symbols.includes(message.symbol)) event.symbol = message.symbol;
        if (['trades', 'books'].includes(message.channel)) event.channel = message.channel;
        if (['symbol_error', 'fault', 'fatal'].includes(message.kind)) {
          event.code = ['SNAPSHOT_FAILED', 'SNAPSHOT_RATE_LIMIT', 'DISCONNECTED', 'SUBSCRIPTION_TIMEOUT',
            'BROKER_ERROR', 'HEARTBEAT_TIMEOUT', 'CONNECTION_FAILED', 'SDK_VERSION', 'CREDENTIALS', 'LOGIN_FAILED'].includes(message.code) ? message.code : 'UNKNOWN';
          this.protocolErrors[event.code] = (this.protocolErrors[event.code] ?? 0) + 1;
        }
        this.emit(event);
      }
    }
    if (message?.kind !== 'quote' || !this.totals[message.data?.symbol]) return;
    const d = message.data, channel = message.channel, symbol = d.symbol;
    if (channel === 'snapshot') { this.count(symbol, 'restSnapshot', wall); return; }
    if (!['trades', 'books'].includes(channel)) return;
    const isData = message.sourceEvent === 'data', isSnapshot = message.sourceEvent === 'snapshot';
    this.count(symbol, isData ? 'wsData' : isSnapshot ? 'wsSnapshot' : 'sourceUnavailable', wall);
    if (!isData && !isSnapshot) { this.errors.add('SOURCE_EVENT_UNAVAILABLE'); return; }
    if (d.isTrial) { this.count(symbol, 'trial', wall); return; }
    const sourceTime = d.time ?? d.lastUpdated;
    const rowMatches = channel === 'trades' ? row?.tradeTime === d.time && row.price === d.price
      : row?.bookTime === sourceTime && signature(row) === signature(d);
    if (result === 'UNSUBSCRIBED' || (result === 'ACCEPTED' && !row?.acknowledged)) { this.count(symbol, 'warming', wall); return; }
    if (result !== 'ACCEPTED' || row.issue ||
        (channel === 'trades' && (!positive(d.price) || !stamp(d.time))) ||
        (channel === 'books' && (!Array.isArray(d.bids) || !Array.isArray(d.asks)))) {
      this.count(symbol, 'rejected', wall); return;
    }
    if (!rowMatches) { this.count(symbol, 'duplicateOrOld', wall); return; }
    if (!stamp(sourceTime) || taipeiDate(sourceTime / 1000) !== this.window.date ||
        sourceTime / 1000 > wall + 2000 || wall - sourceTime / 1000 > POLICY.freshMs) {
      this.count(symbol, 'staleSource', wall); return;
    }
    const key = `${symbol}:${channel}`, old = this.baselines.get(key);
    const next = { time: sourceTime, serial: serial(d.serial), signature: channel === 'books' ? signature(d) : null };
    const timeAdvances = !old || sourceTime > old.time;
    const tradeAdvances = !old || ((timeAdvances || (sourceTime === old.time && next.serial !== null && old.serial !== null && next.serial > old.serial)) &&
      !(next.serial !== null && old.serial !== null && next.serial <= old.serial));
    // Snapshot establishes a baseline only; it can never increment a tick.
    if (!old || timeAdvances || (channel === 'trades' && tradeAdvances)) this.baselines.set(key, next);
    if (!isData) return;
    this.count(symbol, 'acceptedWsData', wall);
    if (sourceTime / 1000 < this.window.open || sourceTime / 1000 > this.window.close) return;
    const advanced = channel === 'trades' ? tradeAdvances : timeAdvances;
    if (advanced) this.lastAccepted.set(key, { epoch, wall, mono, sourceTime });
    // A first image is not evidence of change. Require a second distinct frame.
    const changed = old && advanced && (channel === 'trades' || old.signature !== next.signature);
    if (!changed) { this.count(symbol, 'duplicateOrOld', wall); return; }
    this.count(symbol, channel === 'trades' ? 'newTrades' : 'bookChanges', wall);
    const previous = this.lastAdvance.get(key);
    if (wall < this.window.auction && !this.isPlanned(wall)) this.maxQuiet[symbol][channel] = Math.max(this.maxQuiet[symbol][channel], wall - (previous ?? this.window.open));
    this.lastAdvance.set(key, wall);
    const m = this.minute(wall);
    if (m) {
      const item = m.symbols[symbol]; item[`${channel}LastSourceTime`] = sourceTime;
      item[`${channel}MaxSourceAgeMs`] = Math.max(item[`${channel}MaxSourceAgeMs`] ?? 0, wall - sourceTime / 1000);
      if (channel === 'trades') item.lastTradeSerial = next.serial;
    }
  }
  sample(state, wall, mono) {
    const gap = this.previousPoll ? mono - this.previousPoll.mono : 0;
    const drift = Math.abs(wall - this.startedWall - (mono - this.startedMono));
    if (wall >= this.window.open && wall < this.window.close) {
      this.maxPollGapMs = Math.max(this.maxPollGapMs, gap); this.maxClockDriftMs = Math.max(this.maxClockDriftMs, drift);
    }
    this.previousPoll = { wall, mono };
    const key = `${state.state}:${state.generation}:${state.reason ?? ''}`;
    if (key !== this.previousState) {
      const planned = Boolean(this.isPlanned(wall));
      const transition = { type: 'transition', at: new Date(wall).toISOString(), state: state.state,
        generation: state.generation, reason: state.reason, planned };
      this.transitions.push(transition); this.emit(transition); this.previousState = key;
      if (wall >= this.window.open && wall < this.window.close && state.state === 'reconnecting' && !planned) this.unplannedDisconnects++;
    }
    if (state.liveOrders !== false || state.readOnly !== true) this.errors.add('READ_ONLY_INVARIANT');
    if (state.state === 'stopped') this.errors.add('FEED_STOPPED');
    const m = this.minute(wall);
    if (m) {
      const second = Math.floor((wall - this.window.open) % 60000 / 1000);
      m.seen.add(second); m.samples++; m.generations.add(state.generation); m.states.add(state.state);
      m.pollGapMs = Math.max(m.pollGapMs, gap); m.clockDriftMs = Math.max(m.clockDriftMs, drift);
      if (state.state === 'connected') m.connected.add(second);
      if (this.isPlanned(wall)) m.planned.add(second);
      let subscribed = 0;
      for (const symbol of this.symbols) {
        const row = state.rows.find(r => r.symbol === symbol), item = m.symbols[symbol];
        if (row?.acknowledged) { item.acknowledged.add(second); subscribed += 2; }
        if (row?.tradeFresh) item.tradeFresh.add(second);
        if (row?.bookFresh) item.bookFresh.add(second);
        if (row?.issue) { item.issue.add(second); this.issues[row.issue] = (this.issues[row.issue] ?? 0) + 1; }
        for (const channel of ['trades', 'books']) if (wall < this.window.auction && !this.isPlanned(wall))
          this.maxQuiet[symbol][channel] = Math.max(this.maxQuiet[symbol][channel], wall - (this.lastAdvance.get(`${symbol}:${channel}`) ?? this.window.open));
      }
      const subscriptionCount = Number.isInteger(state.subscriptionCount) ? state.subscriptionCount : subscribed;
      m.subscriptionsMin = Math.min(m.subscriptionsMin, subscriptionCount); m.subscriptionsMax = Math.max(m.subscriptionsMax, subscriptionCount);
    }
    const injection = this.injection;
    if (injection && !injection.recoveredWall && state.generation > injection.generation && state.state === 'connected' &&
        this.symbols.every(s => state.rows.find(r => r.symbol === s)?.acknowledged && !state.rows.find(r => r.symbol === s)?.issue && ['trades', 'books'].every(c => {
          const last = this.lastAccepted.get(`${s}:${c}`);
          return last?.epoch === state.generation && last.sourceTime / 1000 >= injection.wall;
        }))) {
      injection.recoveredWall = wall; injection.recoveredMono = mono; injection.newGeneration = state.generation;
      injection.recoveryMs = mono - injection.mono; this.emit({ type: 'recovery', ...injection });
    }
  }
  canInject(state, wall) {
    return !this.injection && wall >= this.window.reconnect && wall <= this.window.reconnect + 5 * 60000 &&
      state.state === 'connected' && this.symbols.every(s => state.rows.find(r => r.symbol === s)?.acknowledged && !state.rows.find(r => r.symbol === s)?.issue &&
        ['trades', 'books'].every(c => { const last = this.lastAccepted.get(`${s}:${c}`); return last?.epoch === state.generation && wall - last.wall < 30000; }));
  }
  inject(generation, wall, mono) { this.injection = { generation, wall, mono }; this.emit({ type: 'injection', ...this.injection }); }
  minuteRecord(m) {
    const { seen, connected, planned, generations, states, symbols, ...rest } = m;
    return { type: 'minute', ...rest, coveredSeconds: seen.size, connectedSeconds: connected.size,
      plannedSeconds: planned.size, unexpectedDisconnectedSeconds: [...seen].filter(s => !connected.has(s) && !planned.has(s)).length,
      generations: [...generations], states: [...states], symbols: Object.fromEntries(Object.entries(symbols).map(([s, item]) => {
        const { acknowledged, tradeFresh, bookFresh, issue, ...summary } = item;
        return [s, { ...summary, acknowledgedSeconds: acknowledged.size, tradeFreshSeconds: tradeFresh.size,
          bookFreshSeconds: bookFresh.size, issueSeconds: issue.size,
          unexpectedUnsubscribedSeconds: [...seen].filter(n => !acknowledged.has(n) && !planned.has(n)).length }];
      })) };
  }
  flush(wall, final = false) {
    for (const [index, m] of this.minutes) if (index > this.lastFlushed && (final || this.window.open + (index + 1) * 60000 <= wall)) {
      this.emit(this.minuteRecord(m)); this.lastFlushed = index;
    }
  }
  finish(wall, mono, reason = 'scheduled_end') {
    this.maxClockDriftMs = Math.max(this.maxClockDriftMs, Math.abs(wall - this.startedWall - (mono - this.startedMono)));
    this.flush(wall, true);
    const minutes = [...this.minutes.values()].map(m => this.minuteRecord(m));
    const incomplete = [], review = [];
    if (this.startedWall > this.window.open) incomplete.push('LATE_START');
    if (wall < this.window.stop || reason !== 'scheduled_end') incomplete.push('EARLY_OR_INTERRUPTED_END');
    if (minutes.length !== 270 || minutes.some(m => m.coveredSeconds !== 60)) incomplete.push('MISSING_COVERAGE');
    if (this.maxPollGapMs > POLICY.maxPollGapMs) incomplete.push('COLLECTION_GAP');
    if (this.maxClockDriftMs > POLICY.maxClockDriftMs) incomplete.push('CLOCK_DRIFT');
    for (const [symbol, total] of Object.entries(this.totals)) {
      if (total.newTrades < POLICY.minChanges || total.bookChanges < POLICY.minChanges) incomplete.push(`MISSING_WS_CHANGES:${symbol}`);
      if (Object.values(this.maxQuiet[symbol]).some(n => n > POLICY.maxQuietMs)) review.push(`QUIET_SOURCE_REVIEW:${symbol}`);
      if (total.sourceUnavailable) incomplete.push(`SOURCE_UNKNOWN:${symbol}`);
      if (minutes.some(m => m.symbols[symbol].counts.rejected)) review.push(`REJECTED_FRAMES:${symbol}`);
    }
    if (!this.injection || !this.injection.recoveredWall) incomplete.push('RECONNECT_NOT_VERIFIED');
    else if (this.injection.recoveryMs > POLICY.maxRecoveryMs) review.push('SLOW_CONTROLLED_RECOVERY');
    if (this.unplannedDisconnects) review.push('UNPLANNED_DISCONNECT');
    if (minutes.some(m => m.unexpectedDisconnectedSeconds || Object.values(m.symbols).some(s => s.unexpectedUnsubscribedSeconds || s.issueSeconds))) review.push('UNEXPECTED_UNAVAILABLE_SECONDS');
    incomplete.push(...this.errors);
    const status = incomplete.length ? 'INCOMPLETE' : review.length ? 'REVIEW_REQUIRED' : 'PASS';
    return { schema: 1, scope: 'isolated_readonly_broker_session', productionUiVerified: false,
      readOnly: true, orderRequests: 0, status, passed: status === 'PASS', date: this.window.date,
      startedAt: new Date(this.startedWall).toISOString(), finishedAt: new Date(wall).toISOString(),
      durationMs: mono - this.startedMono, reason, policy: POLICY, incomplete, review,
      coverageMinutes: minutes.length, coveredSeconds: minutes.reduce((n, m) => n + m.coveredSeconds, 0),
      expectedSeconds: 16200, maxPollGapMs: this.maxPollGapMs, maxClockDriftMs: this.maxClockDriftMs,
      unplannedDisconnects: this.unplannedDisconnects, injection: this.injection, totals: this.totals,
      maxQuietMs: this.maxQuiet, issueSampleCounts: this.issues,
      protocolCounts: this.protocolCounts, protocolErrors: this.protocolErrors,
      limitations: ['No production HTTP or authenticated UI proof.', 'No packet completeness claim: broker serial is not assumed contiguous.',
        'Quiet source intervals require review; they are not automatically broker outages.', '13:25–13:30 auction is covered but excluded from continuous-change silence thresholds.'] };
  }
}
