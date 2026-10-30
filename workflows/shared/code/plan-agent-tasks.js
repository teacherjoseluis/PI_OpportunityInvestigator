// Canonical source for the PII-00 supervisor planner.
// Plans agent_tasks, selects a ready wave, applies result envelopes, and replans fill-ins.
// The n8n path (no action) returns the shadow/dispatch plan for the current case.

const crypto = require('crypto');

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'INSUFFICIENT', 'SKIPPED']);
const SUCCESSISH = new Set(['SUCCEEDED', 'INSUFFICIENT', 'SKIPPED']);
const WAVE_ORDER = [
  'gate_identity',
  'gate_eligibility',
  'collect',
  'collect_join',
  'specialists',
  'specialists_followup',
  'challenge',
  'quality',
  'publish',
  'delivery',
];

const PROVIDER_BY_AGENT = {
  'PII-03-SEC': 'sec_edgar',
  'PII-03-XBRL': 'sec_edgar',
  'PII-03-CT': 'clinicaltrials',
  'PII-03-FDA': 'openfda',
  'PII-03-NEWS': 'finnhub',
  'PII-03-USPTO': 'uspto',
  'PII-03-CL': 'courtlistener',
  'PII-03-MKT': 'twelvedata',
  'PII-03': 'sec_edgar',
};

const STALE_SOURCE_MAP = {
  sec_edgar: {
    collectors: ['PII-03-SEC', 'PII-03-XBRL'],
    specialists: ['PII-04', 'PII-07', 'PII-08'],
  },
  sec: {
    collectors: ['PII-03-SEC', 'PII-03-XBRL'],
    specialists: ['PII-04', 'PII-07', 'PII-08'],
  },
  clinicaltrials: { collectors: ['PII-03-CT'], specialists: ['PII-06', 'PII-07'] },
  fda: { collectors: ['PII-03-FDA'], specialists: ['PII-07'] },
  news: { collectors: ['PII-03-NEWS'], specialists: ['PII-05'] },
  uspto: { collectors: ['PII-03-USPTO'], specialists: ['PII-09'] },
  courtlistener: { collectors: ['PII-03-CL'], specialists: ['PII-09'] },
  market: { collectors: ['PII-03-MKT'], specialists: ['PII-16', 'PII-08'] },
};

function defaultCatalog() {
  return {
    max_parallel_collectors_per_case: 6,
    max_parallel_specialists_per_case: 6,
    max_concurrent_full_cases: 2,
    shadow_plan_only: false,
    provider_concurrency: {
      sec_edgar: 1,
      twelvedata: 1,
      finnhub: 1,
      uspto: 1,
      openfda: 1,
      courtlistener: 1,
      clinicaltrials: 2,
    },
    collector_facade: {
      enabled: false,
      agent_key: 'PII-03',
      covers: [
        'PII-03-SEC',
        'PII-03-XBRL',
        'PII-03-CT',
        'PII-03-FDA',
        'PII-03-NEWS',
        'PII-03-USPTO',
        'PII-03-CL',
      ],
    },
    agents: [
      { agent_key: 'PII-01', wave: 'gate_identity', mandatory: true, depends_on: [] },
      {
        agent_key: 'PII-02',
        wave: 'gate_eligibility',
        mandatory: true,
        depends_on: ['PII-01'],
      },
      {
        agent_key: 'PII-03-COVER',
        wave: 'collect_join',
        mandatory: true,
        depends_on: [],
      },
      {
        agent_key: 'PII-04',
        wave: 'specialists',
        mandatory: true,
        depends_on: ['PII-03-COVER'],
      },
      {
        agent_key: 'PII-05',
        wave: 'specialists',
        mandatory: true,
        depends_on: ['PII-03-COVER'],
      },
      {
        agent_key: 'PII-06',
        wave: 'specialists',
        mandatory: true,
        depends_on: ['PII-03-COVER'],
      },
      {
        agent_key: 'PII-07',
        wave: 'specialists',
        mandatory: true,
        depends_on: ['PII-03-COVER'],
      },
      {
        agent_key: 'PII-08',
        wave: 'specialists',
        mandatory: true,
        depends_on: ['PII-03-COVER'],
      },
      {
        agent_key: 'PII-16',
        wave: 'specialists',
        mandatory: true,
        depends_on: ['PII-03-COVER'],
      },
      {
        agent_key: 'PII-16-EVENTS',
        wave: 'specialists_followup',
        mandatory: false,
        depends_on: ['PII-16', 'PII-07'],
      },
      {
        agent_key: 'PII-09',
        wave: 'challenge',
        mandatory: true,
        depends_on: ['PII-04', 'PII-05', 'PII-06', 'PII-07', 'PII-08', 'PII-16'],
      },
      { agent_key: 'PII-10', wave: 'quality', mandatory: true, depends_on: ['PII-09'] },
      { agent_key: 'PII-11', wave: 'publish', mandatory: true, depends_on: ['PII-10'] },
      { agent_key: 'PII-14', wave: 'delivery', mandatory: false, depends_on: ['PII-11'] },
      { agent_key: 'PII-15', wave: 'delivery', mandatory: false, depends_on: ['PII-11'] },
    ],
    collectors: [
      { agent_key: 'PII-03-SEC', enabled: true, wave: 'collect', depends_on: ['PII-02'] },
      { agent_key: 'PII-03-XBRL', enabled: true, wave: 'collect', depends_on: ['PII-02'] },
      { agent_key: 'PII-03-CT', enabled: true, wave: 'collect', depends_on: ['PII-02'] },
      { agent_key: 'PII-03-FDA', enabled: true, wave: 'collect', depends_on: ['PII-02'] },
      { agent_key: 'PII-03-NEWS', enabled: true, wave: 'collect', depends_on: ['PII-02'] },
      { agent_key: 'PII-03-USPTO', enabled: true, wave: 'collect', depends_on: ['PII-02'] },
      { agent_key: 'PII-03-CL', enabled: true, wave: 'collect', depends_on: ['PII-02'] },
      { agent_key: 'PII-03-MKT', enabled: true, wave: 'collect', depends_on: ['PII-02'] },
    ],
    event_type_map: {
      CLINICAL_RESULT: ['PII-03-CT', 'PII-06', 'PII-07', 'PII-16-EVENTS', 'PII-09'],
      FDA_DECISION: ['PII-03-FDA', 'PII-07', 'PII-16-EVENTS', 'PII-09'],
      SEC_FILING: ['PII-03-SEC', 'PII-03-XBRL', 'PII-04', 'PII-08', 'PII-09'],
      FINANCING: ['PII-03-SEC', 'PII-04', 'PII-08', 'PII-16', 'PII-09'],
      PRICE_VOLUME: ['PII-03-MKT', 'PII-16', 'PII-09'],
      PARTNERSHIP: ['PII-03-NEWS', 'PII-03-SEC', 'PII-05', 'PII-09'],
      PATENT: ['PII-03-USPTO', 'PII-09'],
      LITIGATION: ['PII-03-CL', 'PII-09'],
    },
  };
}

function catalogFrom(input) {
  const base = defaultCatalog();
  const incoming = input.agents_config || input.catalog || null;
  if (!incoming) return base;
  return Object.assign({}, base, incoming, {
    agents: incoming.agents || base.agents,
    collectors: incoming.collectors || base.collectors,
    event_type_map: incoming.event_type_map || base.event_type_map,
    provider_concurrency: Object.assign(
      {},
      base.provider_concurrency,
      incoming.provider_concurrency || {},
    ),
    collector_facade: Object.assign({}, base.collector_facade, incoming.collector_facade || {}),
  });
}

function cloneTask(defn, extra) {
  return {
    agent_key: defn.agent_key,
    wave: defn.wave,
    mandatory: defn.mandatory !== false,
    depends_on: (defn.depends_on || []).slice(),
    status: 'BLOCKED',
    provider: PROVIDER_BY_AGENT[defn.agent_key] || null,
    objective: extra.objective || defn.agent_key,
    fill_in: false,
  };
}

function enabledCollectors(catalog) {
  return (catalog.collectors || []).filter((row) => row.enabled !== false);
}

function indexAgents(catalog) {
  const map = {};
  for (const agent of catalog.agents || []) map[agent.agent_key] = agent;
  for (const collector of catalog.collectors || []) {
    map[collector.agent_key] = {
      agent_key: collector.agent_key,
      wave: collector.wave || 'collect',
      mandatory: true,
      depends_on: collector.depends_on || ['PII-02'],
    };
  }
  return map;
}

function restrictDeps(tasks) {
  const keys = new Set(tasks.map((task) => task.agent_key));
  for (const task of tasks) {
    task.depends_on = task.depends_on.filter((key) => keys.has(key) && key !== task.agent_key);
  }
  return tasks;
}

function graphHash(mode, tasks) {
  const body = tasks
    .map((task) => task.agent_key + ':' + task.depends_on.slice().sort().join('+'))
    .sort()
    .join('|');
  return crypto
    .createHash('sha256')
    .update(mode + '|' + body)
    .digest('hex')
    .slice(0, 16);
}

function refreshStatuses(tasks) {
  const byKey = {};
  for (const task of tasks) byKey[task.agent_key] = task;
  let changed = true;
  let guard = 0;
  while (changed && guard < 12) {
    changed = false;
    guard += 1;
    for (const task of tasks) {
      if (TERMINAL.has(task.status) || task.status === 'RUNNING') continue;
      const deps = task.depends_on.map((key) => byKey[key]).filter(Boolean);
      if (deps.some((dep) => dep.status === 'FAILED')) {
        task.status = 'SKIPPED';
        task.skip_reason = 'dependency_failed';
        changed = true;
        continue;
      }
      const waiting = deps.some((dep) => !SUCCESSISH.has(dep.status));
      const next = waiting ? 'BLOCKED' : 'READY';
      if (task.status !== next) {
        task.status = next;
        changed = true;
      }
    }
  }
  return tasks;
}

function collectAllowed(input) {
  if (input.collect_allowed === false) return false;
  const outcome = String(input.eligibility_outcome || '').toUpperCase();
  if (!outcome) return true;
  return outcome === 'PASS' || outcome === 'PASS_WITH_EXCEPTION';
}

function planFull(catalog, input) {
  const agents = indexAgents(catalog);
  const tasks = [];
  tasks.push(cloneTask(agents['PII-01'], { objective: 'Resolve identity' }));
  tasks.push(cloneTask(agents['PII-02'], { objective: 'Eligibility gate' }));
  if (!collectAllowed(input)) {
    return restrictDeps(refreshStatuses(tasks));
  }
  const collectors = enabledCollectors(catalog);
  for (const collector of collectors) {
    tasks.push(
      cloneTask(agents[collector.agent_key], { objective: 'Collect ' + collector.agent_key }),
    );
  }
  const cover = cloneTask(agents['PII-03-COVER'], { objective: 'Coverage join' });
  cover.depends_on = collectors.map((row) => row.agent_key);
  tasks.push(cover);
  for (const key of ['PII-04', 'PII-05', 'PII-06', 'PII-07', 'PII-08', 'PII-16']) {
    tasks.push(cloneTask(agents[key], { objective: key }));
  }
  tasks.push(cloneTask(agents['PII-16-EVENTS'], { objective: 'Event-window reaction' }));
  tasks.push(cloneTask(agents['PII-09'], { objective: 'Red team' }));
  tasks.push(cloneTask(agents['PII-10'], { objective: 'Score' }));
  tasks.push(cloneTask(agents['PII-11'], { objective: 'Report' }));
  tasks.push(cloneTask(agents['PII-14'], { objective: 'Email' }));
  tasks.push(cloneTask(agents['PII-15'], { objective: 'Slack' }));
  return restrictDeps(refreshStatuses(tasks));
}

function closeoutKeys(materiality) {
  const level = String(materiality || 'MEDIUM').toUpperCase();
  if (level === 'LOW') return ['PII-09'];
  return ['PII-09', 'PII-10', 'PII-11', 'PII-14', 'PII-15'];
}

function planEvent(catalog, input) {
  const agents = indexAgents(catalog);
  const eventType = String(input.event_type || '').toUpperCase();
  const mapped = (catalog.event_type_map && catalog.event_type_map[eventType]) || [];
  const keys = new Set(mapped);
  if ([...keys].some((key) => String(key).startsWith('PII-16'))) {
    keys.add('PII-03-MKT');
    keys.add('PII-16');
  }
  for (const key of closeoutKeys(input.materiality)) keys.add(key);
  const tasks = [];
  for (const key of keys) {
    const defn = agents[key];
    if (!defn) continue;
    tasks.push(cloneTask(defn, { objective: eventType + ' ' + key }));
  }
  return restrictDeps(refreshStatuses(tasks));
}

function planRefresh(catalog, input) {
  const agents = indexAgents(catalog);
  const stale = Array.isArray(input.stale_sources) ? input.stale_sources : [];
  const keys = new Set();
  for (const source of stale) {
    const mapped = STALE_SOURCE_MAP[String(source)] || STALE_SOURCE_MAP[String(source).toLowerCase()];
    if (!mapped) continue;
    for (const key of mapped.collectors) keys.add(key);
    for (const key of mapped.specialists) keys.add(key);
  }
  if (keys.size) {
    for (const key of ['PII-09', 'PII-10', 'PII-11']) keys.add(key);
  }
  const tasks = [];
  for (const key of keys) {
    const defn = agents[key];
    if (!defn) continue;
    tasks.push(cloneTask(defn, { objective: 'Refresh ' + key }));
  }
  return restrictDeps(refreshStatuses(tasks));
}

function planTasks(input) {
  const catalog = catalogFrom(input || {});
  const mode = String((input && input.mode) || 'FULL').toUpperCase();
  let tasks;
  if (mode === 'EVENT_REASSESSMENT') tasks = planEvent(catalog, input || {});
  else if (mode === 'REFRESH') tasks = planRefresh(catalog, input || {});
  else tasks = planFull(catalog, input || {});
  const hash = graphHash(mode, tasks);
  const dispatch_tasks = dispatchTasks(tasks, catalog);
  const executable = catalog.shadow_plan_only !== false ? dispatch_tasks : tasks;
  return {
    mode,
    graph_hash: hash,
    planned_tasks: tasks,
    dispatch_tasks,
    dispatch_keys: '|' + executable.map((task) => task.agent_key).join('|') + '|',
    shadow_plan_only: catalog.shadow_plan_only !== false,
    canvas_executes: catalog.shadow_plan_only !== false ? 'FULL_DEPENDENCY_SERIAL' : 'SUPERVISOR_WAVES',
  };
}

function dispatchTasks(tasks, catalog) {
  const facade = catalog.collector_facade || {};
  if (facade.enabled === false) return tasks.map((task) => Object.assign({}, task));
  const covers = new Set(facade.covers || []);
  const covered = tasks.filter((task) => covers.has(task.agent_key));
  if (!covered.length) return tasks.map((task) => Object.assign({}, task));
  const rest = tasks
    .filter((task) => !covers.has(task.agent_key))
    .map((task) => Object.assign({}, task, { depends_on: task.depends_on.slice() }));
  const facadeTask = {
    agent_key: facade.agent_key || 'PII-03',
    wave: 'collect',
    mandatory: true,
    depends_on: ['PII-02'].filter((key) => rest.some((task) => task.agent_key === key) || tasks.some((task) => task.agent_key === key)),
    status: 'BLOCKED',
    provider: 'sec_edgar',
    objective: 'Collection facade',
    fill_in: false,
    covers: covered.map((task) => task.agent_key),
  };
  const keysPresent = new Set(rest.map((task) => task.agent_key));
  if (!keysPresent.has('PII-02') && !tasks.some((task) => task.agent_key === 'PII-02')) {
    facadeTask.depends_on = [];
  }
  rest.push(facadeTask);
  for (const task of rest) {
    if (task.agent_key === 'PII-03-COVER') {
      task.depends_on = task.depends_on
        .filter((key) => !covers.has(key))
        .concat([facadeTask.agent_key]);
    }
  }
  return restrictDeps(refreshStatuses(rest));
}

function selectReadyWave(tasks, catalogInput) {
  const catalog = catalogFrom(catalogInput || {});
  refreshStatuses(tasks);
  const ready = tasks.filter((task) => task.status === 'READY');
  if (!ready.length) return { wave: null, tasks: [] };
  let wave = null;
  for (const name of WAVE_ORDER) {
    if (ready.some((task) => task.wave === name)) {
      wave = name;
      break;
    }
  }
  if (!wave) wave = ready[0].wave;
  const pool = ready
    .filter((task) => task.wave === wave)
    .slice()
    .sort((a, b) => String(a.agent_key).localeCompare(String(b.agent_key)));
  const limit =
    wave === 'collect'
      ? Number(catalog.max_parallel_collectors_per_case || 6)
      : wave === 'specialists' || wave === 'specialists_followup'
        ? Number(catalog.max_parallel_specialists_per_case || 6)
        : pool.length;
  const caps = catalog.provider_concurrency || {};
  const chosen = [];
  const providerCount = {};
  for (const task of pool) {
    if (chosen.length >= limit) break;
    const provider = task.provider;
    if (provider) {
      const cap = Number(caps[provider] || 99);
      if ((providerCount[provider] || 0) >= cap) continue;
      providerCount[provider] = (providerCount[provider] || 0) + 1;
    }
    chosen.push(task);
  }
  return { wave, tasks: chosen };
}

function applyResult(tasks, result) {
  const task = tasks.find((row) => row.agent_key === result.agent_key);
  if (!task) return { applied: false, tasks };
  const status = String(result.status || 'FAILED').toUpperCase();
  task.status = TERMINAL.has(status) ? status : 'FAILED';
  task.result = {
    status: task.status,
    outcome: result.outcome || null,
    insufficient_topics: result.insufficient_topics || [],
    fill_in_suggestions: result.fill_in_suggestions || [],
    error_summary: result.error_summary || null,
    collect_allowed: result.collect_allowed,
  };
  if (task.agent_key === 'PII-02' && result.collect_allowed === false) {
    for (const other of tasks) {
      if (other.agent_key === 'PII-01' || other.agent_key === 'PII-02') continue;
      if (!TERMINAL.has(other.status)) {
        other.status = 'SKIPPED';
        other.skip_reason = 'eligibility_blocked_collection';
      }
    }
  }
  refreshStatuses(tasks);
  return { applied: true, tasks };
}

function reopenDependents(tasks, agentKey) {
  const queue = [agentKey];
  const seen = new Set([agentKey]);
  while (queue.length) {
    const key = queue.shift();
    for (const task of tasks) {
      if (!Array.isArray(task.depends_on) || !task.depends_on.includes(key)) continue;
      if (seen.has(task.agent_key)) continue;
      seen.add(task.agent_key);
      if (task.status === 'SUCCEEDED' || task.status === 'INSUFFICIENT') {
        task.status = 'BLOCKED';
        task.fill_in = true;
      }
      queue.push(task.agent_key);
    }
  }
}

function replanFillIns(tasks, suggestions, budget) {
  const limits = budget || {};
  const maxAdds = Number(limits.max_fill_ins ?? 2);
  let httpLeft = Number(limits.remaining_http_calls ?? limits.max_http_calls ?? 4);
  const added = [];
  const list = Array.isArray(suggestions) ? suggestions : [];
  for (const suggestion of list) {
    if (added.length >= maxAdds || httpLeft <= 0) break;
    const agentKey = suggestion.agent_key || suggestion.collector;
    if (!agentKey) continue;
    const existing = tasks.find((task) => task.agent_key === agentKey);
    const retryable =
      existing &&
      (existing.status === 'FAILED' ||
        existing.status === 'INSUFFICIENT' ||
        existing.status === 'SUCCEEDED');
    if (existing && !retryable) continue;
    if (retryable) {
      existing.status = 'READY';
      existing.fill_in = true;
      existing.attempt = Number(existing.attempt || 0) + 1;
      existing.objective = suggestion.reason || existing.objective;
      reopenDependents(tasks, agentKey);
      added.push(existing);
      httpLeft -= 1;
      continue;
    }
    const task = {
      agent_key: agentKey,
      wave: String(agentKey).startsWith('PII-03') ? 'collect' : 'specialists',
      mandatory: false,
      depends_on: [],
      status: 'READY',
      provider: PROVIDER_BY_AGENT[agentKey] || null,
      objective: suggestion.reason || 'fill-in',
      fill_in: true,
      attempt: 1,
    };
    tasks.push(task);
    added.push(task);
    httpLeft -= 1;
  }
  refreshStatuses(tasks);
  return { added, tasks, remaining_http_calls: httpLeft };
}

function decide(tasks) {
  const mandatoryFailed = tasks.filter((task) => task.mandatory && task.status === 'FAILED');
  if (mandatoryFailed.length) {
    return {
      state: 'AWAITING_HUMAN_REVIEW',
      reason: 'mandatory_task_failed',
      failed: mandatoryFailed.map((task) => task.agent_key),
    };
  }
  const open = tasks.filter((task) => !TERMINAL.has(task.status));
  if (open.length) {
    return { state: 'RUNNING', reason: 'tasks_open', open: open.map((task) => task.agent_key) };
  }
  const eligibility = tasks.find((task) => task.agent_key === 'PII-02');
  if (eligibility && eligibility.result && eligibility.result.collect_allowed === false) {
    return { state: 'AWAITING_HUMAN_REVIEW', reason: 'eligibility_stopped' };
  }
  return { state: 'COMPLETE', reason: 'graph_terminal' };
}

function outcomeFor(script, agentKey, attempt) {
  const raw = script[agentKey];
  if (Array.isArray(raw)) return raw[Math.min(attempt, raw.length - 1)] || { status: 'SUCCEEDED' };
  if (typeof raw === 'function') return raw(attempt);
  if (raw) return raw;
  return { status: 'SUCCEEDED', outcome: 'OK' };
}

function runSupervisor(input) {
  const planned = planTasks(input.request || input);
  const tasks = planned.planned_tasks;
  const script = input.outcomes || {};
  const budget = Object.assign({ max_fill_ins: 2, remaining_http_calls: 4 }, input.budget || {});
  const waves = [];
  for (let guard = 0; guard < 24; guard += 1) {
    const decision = decide(tasks);
    if (decision.state !== 'RUNNING') {
      return { plan: planned, tasks, waves, decision, budget };
    }
    const wave = selectReadyWave(tasks, input.request || input);
    if (!wave.tasks.length) {
      return {
        plan: planned,
        tasks,
        waves,
        decision: { state: 'FAILED', reason: 'no_ready_wave' },
        budget,
      };
    }
    waves.push(wave.tasks.map((task) => task.agent_key));
    const suggestions = [];
    for (const task of wave.tasks) {
      task.status = 'RUNNING';
      const attempt = Number(task.attempt || 0);
      const result = Object.assign({ agent_key: task.agent_key }, outcomeFor(script, task.agent_key, attempt));
      applyResult(tasks, result);
      if (Array.isArray(result.fill_in_suggestions)) {
        for (const suggestion of result.fill_in_suggestions) suggestions.push(suggestion);
      }
    }
    if (suggestions.length) replanFillIns(tasks, suggestions, budget);
  }
  return {
    plan: planned,
    tasks,
    waves,
    decision: { state: 'FAILED', reason: 'supervisor_guard' },
    budget,
  };
}

const FILL_IN_COLLECTORS = [
  'PII-03-SEC',
  'PII-03-XBRL',
  'PII-03-CT',
  'PII-03-FDA',
  'PII-03-NEWS',
  'PII-03-USPTO',
  'PII-03-CL',
  'PII-03-MKT',
];

const EXECUTE_NODE_KEYS = [
  ['Execute PII-01 Identity Resolver', 'PII-01'],
  ['Execute PII-02 Eligibility Gate', 'PII-02'],
  ['Execute PII-03 SEC', 'PII-03-SEC'],
  ['Execute PII-03 XBRL', 'PII-03-XBRL'],
  ['Execute PII-03 CT', 'PII-03-CT'],
  ['Execute PII-03 FDA', 'PII-03-FDA'],
  ['Execute PII-03 News', 'PII-03-NEWS'],
  ['Execute PII-03 USPTO', 'PII-03-USPTO'],
  ['Execute PII-03 CourtListener', 'PII-03-CL'],
  ['Execute PII-03-MKT Market Collector', 'PII-03-MKT'],
  ['Execute PII-03 Coverage Join', 'PII-03-COVER'],
  ['Fill-In PII-03 SEC', 'PII-03-SEC'],
  ['Fill-In PII-03 XBRL', 'PII-03-XBRL'],
  ['Fill-In PII-03 CT', 'PII-03-CT'],
  ['Fill-In PII-03 FDA', 'PII-03-FDA'],
  ['Fill-In PII-03 News', 'PII-03-NEWS'],
  ['Fill-In PII-03 USPTO', 'PII-03-USPTO'],
  ['Fill-In PII-03 CourtListener', 'PII-03-CL'],
  ['Fill-In PII-03-MKT', 'PII-03-MKT'],
  ['Execute PII-04 Financial Analyst', 'PII-04'],
  ['Fill-In PII-04 Financial Analyst', 'PII-04'],
  ['Execute PII-05 Growth Analyst', 'PII-05'],
  ['Fill-In PII-05 Growth Analyst', 'PII-05'],
  ['Execute PII-06 Pipeline Analyst', 'PII-06'],
  ['Fill-In PII-06 Pipeline Analyst', 'PII-06'],
  ['Execute PII-07 Regulatory Analyst', 'PII-07'],
  ['Fill-In PII-07 Regulatory Analyst', 'PII-07'],
  ['Execute PII-08 Valuation Analyst', 'PII-08'],
  ['Execute PII-16 Technical Analyst', 'PII-16'],
  ['Fill-In PII-16 Technical Analyst', 'PII-16'],
  ['Execute PII-16 Event Reaction', 'PII-16-EVENTS'],
  ['Execute PII-09 Risk Analyst', 'PII-09'],
  ['Execute PII-10 Scoring Gate', 'PII-10'],
  ['Execute PII-11 Report Generator', 'PII-11'],
  ['Execute PII-14 Email Delivery', 'PII-14'],
  ['Execute PII-15 Slack Notify', 'PII-15'],
];

function nodeLast(name) {
  try {
    const rows = $(name).all();
    if (!rows.length) return null;
    return rows[rows.length - 1].json || null;
  } catch {
    return null;
  }
}

function statusFromRow(row) {
  if (!row || row.skipped === true) return null;
  const status = String(row.status || '').toUpperCase();
  if (TERMINAL.has(status)) return status;
  const outcome = String(row.outcome || '').toUpperCase();
  if (outcome === 'FAILED') return 'FAILED';
  if (outcome === 'INSUFFICIENT') return 'INSUFFICIENT';
  if (row.valid === false) return 'FAILED';
  if (row.outcome || row.next_state || row.case_id) return 'SUCCEEDED';
  return null;
}

function collectFillInSuggestions() {
  const suggestions = [];
  for (const [nodeName] of EXECUTE_NODE_KEYS) {
    const row = nodeLast(nodeName);
    if (!row || !Array.isArray(row.fill_in_suggestions)) continue;
    for (const suggestion of row.fill_in_suggestions) suggestions.push(suggestion);
  }
  return suggestions;
}

function canvasFillIn(input) {
  const suggestions = collectFillInSuggestions().concat(
    Array.isArray(input.suggestions) ? input.suggestions : [],
  );
  const planned = planTasks(input.request || { mode: input.mode || 'FULL', agents_config: input.agents_config });
  const tasks = planned.planned_tasks.map((task) => Object.assign({}, task, { status: 'SUCCEEDED' }));
  const budget = Object.assign({ max_fill_ins: 1, remaining_http_calls: 2 }, input.budget || {});
  const replanned = replanFillIns(tasks, suggestions, budget);
  const agentKeys = replanned.added
    .map((task) => task.agent_key)
    .filter((key) => FILL_IN_COLLECTORS.includes(key));
  return {
    run_fill_in: agentKeys.length > 0,
    agent_keys: agentKeys,
    fill_in_keys: '|' + agentKeys.join('|') + '|',
    remaining_http_calls: replanned.remaining_http_calls,
  };
}

function recordTaskStatuses(input) {
  const planNode = nodeJson('Plan Agent Tasks') || {};
  const request = {
    mode: input.mode || planNode.mode || 'FULL',
    eligibility_outcome: input.eligibility_outcome || null,
    event_type: input.event_type || null,
    materiality: input.materiality || 'MEDIUM',
    stale_sources: input.stale_sources || [],
    agents_config: input.agents_config || null,
  };
  const planned = planTasks(request);
  const tasks = JSON.parse(JSON.stringify(planned.planned_tasks));
  for (const [nodeName, agentKey] of EXECUTE_NODE_KEYS) {
    const row = nodeLast(nodeName);
    const status = statusFromRow(row);
    if (!status) continue;
    applyResult(tasks, {
      agent_key: agentKey,
      status,
      outcome: row.outcome || null,
      insufficient_topics: row.insufficient_topics || [],
      fill_in_suggestions: row.fill_in_suggestions || [],
      error_summary: row.error_summary || row.reason || null,
      collect_allowed: agentKey === 'PII-02' ? row.next_state === 'COLLECTING' : undefined,
    });
  }
  for (const task of tasks) {
    if (!TERMINAL.has(task.status)) {
      task.status = 'SKIPPED';
      task.skip_reason = task.skip_reason || 'canvas_complete';
    }
  }
  const payload = tasks.map((task) => ({
    agent_key: task.agent_key,
    status: task.status,
    result_json: {
      outcome: task.result ? task.result.outcome : null,
      skip_reason: task.skip_reason || null,
      error_summary: task.result ? task.result.error_summary : null,
    },
  }));
  return {
    case_id: planNode.case_id || input.case_id || null,
    graph_hash: planned.graph_hash,
    tasks_b64: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'),
    task_count: payload.length,
  };
}

function validateEnvelope(kind, envelope) {
  const errors = [];
  const row = envelope || {};
  if (kind === 'input') {
    for (const key of ['task_id', 'case_id', 'agent_key', 'objective', 'mode']) {
      if (!row[key]) errors.push('missing ' + key);
    }
  } else {
    for (const key of ['task_id', 'case_id', 'agent_key', 'status']) {
      if (!row[key]) errors.push('missing ' + key);
    }
    const allowed = ['SUCCEEDED', 'INSUFFICIENT', 'FAILED', 'SKIPPED'];
    if (row.status && !allowed.includes(row.status)) errors.push('bad status');
  }
  return { ok: errors.length === 0, errors };
}

function nodeJson(name) {
  try {
    return $(name).first().json;
  } catch {
    return null;
  }
}

const input = ($input.first() && $input.first().json) || {};
const action = input.action || 'plan';

if (action === 'ready') {
  const tasks = JSON.parse(JSON.stringify(input.tasks || []));
  const wave = selectReadyWave(tasks, { agents_config: input.agents_config });
  return [{ json: { wave: wave.wave, agent_keys: wave.tasks.map((task) => task.agent_key), tasks } }];
}
if (action === 'apply') {
  const tasks = JSON.parse(JSON.stringify(input.tasks || []));
  applyResult(tasks, input.result || {});
  return [{ json: { tasks, decision: decide(tasks) } }];
}
if (action === 'replan') {
  const tasks = JSON.parse(JSON.stringify(input.tasks || []));
  const replanned = replanFillIns(tasks, input.suggestions || [], input.budget || {});
  return [
    {
      json: {
        added: replanned.added.map((task) => task.agent_key),
        tasks: replanned.tasks,
        remaining_http_calls: replanned.remaining_http_calls,
      },
    },
  ];
}
if (action === 'run') {
  return [{ json: runSupervisor(input) }];
}
if (action === 'validate_envelope') {
  return [{ json: validateEnvelope(input.kind || 'output', input.envelope || {}) }];
}
if (action === 'canvas_fill_in') {
  return [{ json: canvasFillIn(input) }];
}
if (action === 'record') {
  return [{ json: recordTaskStatuses(input) }];
}

const validated = nodeJson('Validate Investigation Request') || {};
const inserted = nodeJson('Insert Research Case') || {};
const request = {
  mode: input.mode || validated.mode || 'FULL',
  eligibility_outcome: input.eligibility_outcome || null,
  event_type: input.event_type || validated.event_type || null,
  materiality: input.materiality || validated.materiality || 'MEDIUM',
  stale_sources: input.stale_sources || validated.stale_sources || [],
  agents_config: input.agents_config || null,
  ticker: validated.ticker || inserted.ticker || null,
  case_id: inserted.case_id || validated.case_id || null,
};
const planned = planTasks(request);
const plan_b64 = Buffer.from(JSON.stringify(planned.planned_tasks), 'utf8').toString('base64');
const dispatch_b64 = Buffer.from(JSON.stringify(planned.dispatch_tasks), 'utf8').toString('base64');

return [
  {
    json: {
      case_id: request.case_id,
      mode: planned.mode,
      graph_hash: planned.graph_hash,
      task_count: planned.planned_tasks.length,
      dispatch_count: planned.dispatch_tasks.length,
      shadow_plan_only: planned.shadow_plan_only,
      canvas_executes: planned.canvas_executes,
      dispatch_keys: planned.dispatch_keys,
      plan_b64,
      dispatch_b64,
      planned_tasks: planned.planned_tasks,
      dispatch_tasks: planned.dispatch_tasks,
    },
  },
];
