import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, posix } from 'node:path';

export const STATUSES = ['todo', 'in-progress', 'blocked', 'done', 'dropped'];
export const KINDS = ['PR', 'Docs', 'Action', 'Wait'];
export const RISKS = ['Low', 'Medium', 'High'];
export const MIGRATIONS_DIR = '.safe-migrations';
export const INDEX_PATH = `${MIGRATIONS_DIR}/README.md`;
export const CHECKS_DIR = 'checks';
export const CHECK_RUNNERS = { mjs: ['node'], ts: ['node', '--import', 'tsx'], sh: ['bash'] };
export const CHECK_GUARANTEES = [
  'Progress',
  'Zero downtime',
  'Zero data loss',
  'Backwards compatible'
];
export const REQUIRED_FILES = ['README.md', 'plan.md', 'progress.md', 'safety.md'];
export const ALLOWED_ENTRIES = [...REQUIRED_FILES, 'design.md', CHECKS_DIR];
export const REQUIRED_SECTIONS = {
  'README.md': ['Status', 'Goal', 'Files', 'The rules in one screen', 'How agents work on this'],
  'plan.md': [
    'Safety contract',
    'How risk is rated',
    'Phases at a glance',
    'Prod path',
    'Health checks',
    'Step scopes'
  ],
  'progress.md': [
    'Now',
    'How to update this file',
    'Blockers',
    'Phase gates',
    'Steps',
    'Approvals',
    'Decision log',
    'Open questions',
    'Live write log',
    'Evidence log'
  ],
  'safety.md': [
    'The ground we are protecting',
    'Invariants',
    'Compatibility',
    'Failure modes',
    'The way back at every point'
  ]
};
export const STATUS_START = '<!-- safe-migration:status:start -->';
export const STATUS_END = '<!-- safe-migration:status:end -->';
export const SCOPES_HEADING = 'Step scopes';
export const CONTRACT_HEADING = 'Safety contract';
export const HEALTH_HEADING = 'Health checks';
export const DOCS_URL = 'https://github.com/crvouga/agent-skills/blob/main/skills/safe-migration';
export const LEGACY_PATH = `${MIGRATIONS_DIR}/legacy.json`;
export const PLACEHOLDER = 'TODO(';
export const SMALL_STEP_LINES = 500;
export const STALE_DAYS = 14;

export const GUARANTEES = [
  {
    key: 'zero-downtime',
    name: 'Zero downtime',
    test: /^zero downtime/i,
    meaning: 'No step, and no undo of a step, makes the product unavailable or slower for anyone.'
  },
  {
    key: 'zero-data-loss',
    name: 'Zero data loss',
    test: /^zero data loss/i,
    meaning:
      'No write is dropped, duplicated or corrupted, and nothing is deleted while anything can still read it.'
  },
  {
    key: 'backwards-compatible',
    name: 'Backwards compatible',
    test: /^backwards?[ -]compatib/i,
    meaning:
      'The previous release runs on the new state and the new release runs on the old state, at every step.'
  },
  {
    key: 'small-steps',
    name: 'Small uniform steps',
    test: /^small uniform steps/i,
    meaning:
      'Every step is one PR or one action of a known pattern, with one proof and one way back.'
  },
  {
    key: 'low-risk',
    name: 'Low risk',
    test: /^low risk/i,
    meaning:
      'Every step is rated Low after its safeguards; a step that is not is split until it is.'
  }
];

export const PATTERNS = {
  decide: {
    kinds: ['Docs', 'Action'],
    what: 'Record a decision, a spike result or a finding. Nothing that runs changes.'
  },
  observe: {
    kinds: ['Action', 'Docs', 'PR'],
    what: 'Read-only look at the real system: an audit, a measurement, a dry run, a parity check, a rehearsal on a disposable copy.'
  },
  guard: {
    kinds: ['PR', 'Action'],
    what: 'Add a check, test, alert or health check that starts warn-only.'
  },
  enforce: {
    kinds: ['PR', 'Action'],
    what: 'Make a guard blocking, after it soaked quietly.',
    after: 'a guard, then a soak'
  },
  expand: {
    kinds: ['PR', 'Action'],
    what: 'Add the new thing beside the old one, unused or switched off. Nothing existing changes.'
  },
  'dual-write': {
    kinds: ['PR'],
    what: 'Write every new change to both the old and the new place; the old place stays the source of truth.'
  },
  backfill: {
    kinds: ['Action', 'PR'],
    human: true,
    what: 'Copy existing data to the new place: idempotent, resumable, throttled, old data untouched.',
    after: 'an observe step (the dry run) in the same phase'
  },
  switch: {
    kinds: ['Action', 'PR'],
    human: true,
    what: 'Turn the new path on for exactly one target (a flag, a variable, a percentage, one database).',
    after: 'an observe step (the dry run or readiness check) in the same phase'
  },
  move: {
    kinds: ['PR'],
    what: 'Move one batch of callers or readers to the new path; the old path keeps working.'
  },
  soak: {
    kinds: ['Wait'],
    what: 'Wait a fixed time or for a release to reach prod, watching named signals.'
  },
  contract: {
    kinds: ['PR', 'Action'],
    human: true,
    what: 'Remove the old thing, once nothing reads it and it is outside the rollback window.',
    after: 'a soak, with nothing new going live between the soak and the removal'
  },
  cleanup: {
    kinds: ['PR', 'Docs', 'Action'],
    what: 'Remove migration scaffolding (flags, dual writes, shadow checks) and finish the docs.'
  }
};

const GOES_LIVE = ['expand', 'dual-write', 'backfill', 'switch', 'move'];
const STEP_ID = /^[A-Z][A-Z0-9]*-\d+\.\d+$/;
const MIGRATION_NAME = /^[a-z][a-z0-9-]*$/;
const CHECK_ID = /^[a-z][a-z0-9-]*$/;
const RUNTIME_GUARANTEES = ['zero-downtime', 'zero-data-loss', 'backwards-compatible'];
const APPEND_ONLY = /^(Approvals|Decision log|Evidence log|Live (database )?write log)$/;
export const APPROVALS_HEADING = 'Approvals';
const WRITE_LOG = /^Live (database )?write log$/;

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function blank(value) {
  return !value || /^(none|n\/a|-|—|\?|tbd|todo)\.?$/i.test(String(value).trim());
}

export function splitRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  const body = trimmed.slice(1, -1);
  const cells = [];
  let current = '';
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === '\\' && body[i + 1] === '|') {
      current += '\\|';
      i++;
      continue;
    }
    if (char === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function isSeparator(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

export function formatRow(cells) {
  return `| ${cells.map((cell) => cell.replace(/\r?\n/g, ' ')).join(' | ')} |`;
}

function escapeCell(value) {
  return String(value)
    .replace(/\r?\n/g, ' ')
    .replace(/(?<!\\)\|/g, '\\|');
}

export function formatTable(header, rows) {
  const all = [header, ...rows].map((row) => row.map((cell) => escapeCell(cell ?? '')));
  const widths = header.map((_, i) => Math.max(3, ...all.map((row) => (row[i] ?? '').length)));
  const line = (row) => `| ${row.map((cell, i) => (cell ?? '').padEnd(widths[i])).join(' | ')} |`;
  return [
    line(all[0]),
    `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`,
    ...all.slice(1).map(line)
  ].join('\n');
}

export function readTables(text) {
  const lines = text.split('\n');
  const tables = [];
  let section = '';
  let table = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const heading = /^(#{2,3}) (.+)$/.exec(line);
    if (heading) {
      if (heading[1] === '##') section = heading[2].trim();
      table = null;
      continue;
    }
    const cells = splitRow(line);
    if (!cells) {
      table = null;
      continue;
    }
    if (!table) {
      table = { section, header: cells, headerIndex: index, rows: [] };
      tables.push(table);
      continue;
    }
    if (table.rows.length === 0 && isSeparator(cells) && table.separatorIndex === undefined) {
      table.separatorIndex = index;
      continue;
    }
    table.rows.push({ cells, index });
  }
  return { lines, tables };
}

function column(header, name) {
  return header.findIndex((cell) => cell.toLowerCase() === name.toLowerCase());
}

function columnLike(header, pattern) {
  return header.findIndex((cell) => pattern.test(cell));
}

function plain(cell) {
  return (cell ?? '').replace(/[*_`]/g, '').trim();
}

function normalNeeds(cell) {
  const needs = plain(cell).toLowerCase();
  return !needs || /^(nothing|none|no|n\/a|-)\b/.test(needs) || needs === '-' ? 'nothing' : needs;
}

function sectionText(lines, name) {
  const start = lines.findIndex((line) => line.trim() === `## ${name}`);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }
  return {
    start,
    end,
    body: lines
      .slice(start + 1, end)
      .join('\n')
      .trim()
  };
}

export function parsePlan(text) {
  const { lines, tables } = readTables(text);
  const phases = new Map();
  for (const line of lines) {
    const match = /^## Phase (\d+): (.+)$/.exec(line);
    if (match) phases.set(Number(match[1]), match[2].trim());
  }
  const steps = [];
  const scopes = new Map();
  const contract = new Map();
  const phaseInfo = new Map();
  const probes = [];
  const problems = [];
  for (const table of tables) {
    const header = table.header.map((cell) => cell.toLowerCase());
    if (table.section === CONTRACT_HEADING) {
      const how = columnLike(table.header, /^how/i);
      const checkedBy = columnLike(table.header, /^checked by/i);
      for (const row of table.rows) {
        const guarantee = GUARANTEES.find((g) => g.test.test(plain(row.cells[0])));
        if (!guarantee) continue;
        contract.set(guarantee.key, {
          how: how === -1 ? '' : (row.cells[how] ?? ''),
          checkedBy: checkedBy === -1 ? '' : (row.cells[checkedBy] ?? '')
        });
      }
      continue;
    }
    if (table.section === HEALTH_HEADING) {
      const get = (row, name) => {
        const i = column(table.header, name);
        return i === -1 ? '' : (row.cells[i] ?? '');
      };
      for (const row of table.rows) {
        const id = plain(row.cells[0]);
        if (!id) continue;
        const guarantee = plain(get(row, 'Guarantee'));
        const from = plain(get(row, 'From'));
        probes.push({
          id,
          proves: get(row, 'Proves'),
          guarantee:
            CHECK_GUARANTEES.find((name) => name.toLowerCase() === guarantee.toLowerCase()) ??
            guarantee,
          needs: normalNeeds(get(row, 'Needs')),
          from: /^start$/i.test(from) ? '' : from
        });
      }
      continue;
    }
    if (header[0] === 'phase' && header.includes('way back')) {
      for (const row of table.rows) {
        const phase = Number(row.cells[0]);
        if (row.cells[0] === '' || Number.isNaN(phase)) continue;
        phaseInfo.set(phase, {
          wayBack: row.cells[column(table.header, 'Way back')] ?? '',
          liveWrites: row.cells[columnLike(table.header, /^live .*writes?$/i)] ?? ''
        });
      }
      continue;
    }
    for (const row of table.rows) {
      const id = row.cells[0];
      if (!STEP_ID.test(id)) {
        if (STEP_ID.test(plain(id)))
          problems.push(
            `plan.md: step id "${id}" is decorated; write it bare (${plain(id)}) or the step is not read`
          );
        continue;
      }
      const fields = {};
      table.header.forEach((name, i) => (fields[name.toLowerCase()] = row.cells[i] ?? ''));
      if (table.section === SCOPES_HEADING) {
        if (scopes.has(id)) problems.push(`plan.md: ${id} has two scope rows`);
        const files = [...(fields['files'] ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1]);
        scopes.set(id, {
          id,
          kind: fields['kind'] ?? '',
          pattern: plain(fields['pattern']).toLowerCase(),
          wayBack: fields['way back'] ?? '',
          human: /^yes/i.test(fields['human'] ?? ''),
          doneNeedsProd: /^yes/i.test(fields['done needs prod'] ?? ''),
          files
        });
        continue;
      }
      const line = lines[row.index];
      const risks = [...line.matchAll(/\*\*(Low|Medium|High)\b/g)].map((m) => m[1]);
      const parallelWith = [...line.matchAll(/parallel with ([A-Z][A-Z0-9]*-\d+\.\d+)/g)].map(
        (m) => m[1]
      );
      steps.push({
        id,
        phase: Number(id.split('-')[1].split('.')[0]),
        index: steps.length,
        work: fields['work'] ?? fields['object type'] ?? '',
        proof: fields['proof'] ?? '',
        liveWrite: fields['live write'] ?? '',
        writesLive: /^yes/i.test(fields['live write'] ?? ''),
        riskText: fields['risk'] ?? '',
        risk: risks.at(-1) ?? null,
        parallelWith
      });
    }
  }
  const prodPath = [];
  const prodSection = sectionText(lines, 'Prod path');
  if (prodSection) {
    for (const bullet of prodSection.body.split('\n').filter((line) => /^\s*- /.test(line))) {
      const glob = /`([^`]+)`/.exec(bullet)?.[1];
      if (glob) prodPath.push(glob);
      else problems.push(`plan.md: prod path bullet "${bullet.trim()}" has no backticked glob`);
    }
    if (!prodPath.length && !/^none\b/im.test(prodSection.body))
      problems.push(
        'plan.md: "## Prod path" lists no backticked glob and does not say "None": the prod path is undeclared'
      );
  }
  return {
    phases,
    steps,
    scopes,
    contract,
    phaseInfo,
    probes,
    problems,
    prodPath,
    placeholders: lines.filter((line) => line.includes(PLACEHOLDER)).length
  };
}

export function parseProgress(text) {
  const { lines, tables } = readTables(text);
  const steps = new Map();
  const gates = new Map();
  const now = new Map();
  const logs = new Map();
  const sections = new Map();
  const writeLog = [];
  const approvals = [];
  const problems = [];
  for (const table of tables) {
    const header = table.header.map((cell) => cell.toLowerCase());
    sections.set(table.section, (sections.get(table.section) ?? 0) + table.rows.length);
    if (header[0] === 'step' && header.includes('status')) {
      for (const row of table.rows) {
        if (!STEP_ID.test(row.cells[0])) {
          if (STEP_ID.test(plain(row.cells[0])))
            problems.push(
              `progress.md: step id "${row.cells[0]}" is decorated; write it bare or the row is not read`
            );
          continue;
        }
        if (steps.has(row.cells[0])) problems.push(`progress.md: ${row.cells[0]} has two rows`);
        const get = (name) => {
          const i = column(table.header, name);
          return i === -1 ? undefined : (row.cells[i] ?? '');
        };
        steps.set(row.cells[0], {
          id: row.cells[0],
          status: get('status') ?? '',
          pr: get('pr') ?? '',
          ticket: get('ticket') ?? '',
          evidence: get('evidence') ?? '',
          updated: get('updated') ?? '',
          risk: get('risk'),
          index: row.index,
          header: table.header,
          cells: row.cells
        });
      }
    } else if (header[0] === 'phase' && header.includes('met')) {
      for (const row of table.rows) {
        const phase = Number(row.cells[0]);
        if (Number.isNaN(phase)) continue;
        gates.set(phase, {
          phase,
          gate: row.cells[column(table.header, 'gate')] ?? '',
          met: /^yes\b/i.test(row.cells[column(table.header, 'met')] ?? ''),
          evidence: row.cells[column(table.header, 'evidence')] ?? '',
          index: row.index,
          header: table.header,
          cells: row.cells
        });
      }
    } else if (table.section === 'Now') {
      for (const row of table.rows)
        now.set(row.cells[0].toLowerCase(), { ...row, header: table.header });
    }
    if (APPEND_ONLY.test(table.section)) {
      const rows = logs.get(table.section) ?? [];
      for (const row of table.rows) rows.push(row.cells.join(' | '));
      logs.set(table.section, rows);
    }
    if (table.section === APPROVALS_HEADING) {
      const get = (row, pattern) => row.cells[columnLike(table.header, pattern)] ?? '';
      for (const row of table.rows)
        approvals.push({
          step: plain(get(row, /^step$/i)),
          action: plain(get(row, /^action$/i)).toLowerCase(),
          by: get(row, /^approved by/i)
        });
    }
    if (WRITE_LOG.test(table.section)) {
      const dryRun = columnLike(table.header, /^dry run/i);
      const approvedBy = columnLike(table.header, /^approved by/i);
      for (const row of table.rows)
        writeLog.push({
          cells: row.cells,
          date: row.cells[0] ?? '',
          dryRun: dryRun === -1 ? '' : (row.cells[dryRun] ?? ''),
          approvedBy: approvedBy === -1 ? '' : (row.cells[approvedBy] ?? '')
        });
    }
  }
  const blockers = sectionText(lines, 'Blockers');
  return {
    lines,
    steps,
    gates,
    now,
    logs,
    sections,
    writeLog,
    approvals,
    problems,
    blockers:
      blockers && !/^none\.?$/i.test(blockers.body) && blockers.body !== '' ? blockers.body : null,
    placeholders: lines.filter((line) => line.includes(PLACEHOLDER)).length
  };
}

export function wayBackOf(plan, step) {
  const own = plan.scopes.get(step.id)?.wayBack;
  return blank(own) ? (plan.phaseInfo.get(step.phase)?.wayBack ?? '') : own;
}

export function analyse(plan, progress) {
  const statusOf = (id) => progress.steps.get(id)?.status || 'todo';
  const closed = (id) => ['done', 'dropped'].includes(statusOf(id));
  const partners = new Map(plan.steps.map((step) => [step.id, new Set(step.parallelWith)]));
  for (const step of plan.steps)
    for (const partner of step.parallelWith) partners.get(partner)?.add(step.id);
  const waitingOn = (step) =>
    plan.steps
      .filter((other) => other.index < step.index && !closed(other.id))
      .filter((other) => !partners.get(step.id)?.has(other.id))
      .map((other) => other.id);
  const phaseNumbers = [...new Set(plan.steps.map((step) => step.phase))].sort((a, b) => a - b);
  const unmetGates = (phase) =>
    phaseNumbers.filter((p) => p < phase && !progress.gates.get(p)?.met);
  const open = plan.steps.filter((step) => !closed(step.id));
  const current = open.filter((step) => ['in-progress', 'blocked'].includes(statusOf(step.id)));
  const eligible = open.filter(
    (step) =>
      statusOf(step.id) === 'todo' &&
      waitingOn(step).length === 0 &&
      unmetGates(step.phase).length === 0
  );
  const gateDue = phaseNumbers.find(
    (phase) =>
      !progress.gates.get(phase)?.met &&
      plan.steps.filter((step) => step.phase === phase).every((step) => closed(step.id))
  );
  return {
    statusOf,
    closed,
    waitingOn,
    unmetGates,
    current,
    eligible,
    gateDue,
    phaseNumbers,
    partners
  };
}

export function validate(plan, progress) {
  const problems = [...plan.problems, ...progress.problems];
  const ids = plan.steps.map((step) => step.id);
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) problems.push(`plan.md: ${id} appears twice`);
    seen.add(id);
  }
  const prefixes = [...new Set(ids.map((id) => id.split('-')[0]))];
  if (prefixes.length > 1)
    problems.push(
      `plan.md: steps use several prefixes (${prefixes.join(', ')}); a migration has one`
    );
  const checkIds = new Set();
  for (const check of plan.probes) {
    if (!CHECK_ID.test(check.id))
      problems.push(`plan.md: health check "${check.id}" is not a lowercase-dashed name`);
    if (checkIds.has(check.id)) problems.push(`plan.md: health check ${check.id} appears twice`);
    checkIds.add(check.id);
    if (blank(check.proves))
      problems.push(`plan.md: health check ${check.id} does not say what it proves`);
    if (!CHECK_GUARANTEES.includes(check.guarantee))
      problems.push(
        `plan.md: health check ${check.id} guarantee "${check.guarantee}" is not one of ${CHECK_GUARANTEES.join(', ')}`
      );
    if (check.from && !seen.has(check.from))
      problems.push(`plan.md: health check ${check.id} starts from unknown step ${check.from}`);
  }
  if (plan.placeholders)
    problems.push(
      `plan.md: ${plan.placeholders} line(s) still hold a ${PLACEHOLDER}...) placeholder`
    );
  if (progress.placeholders)
    problems.push(
      `progress.md: ${progress.placeholders} line(s) still hold a ${PLACEHOLDER}...) placeholder`
    );
  for (const guarantee of GUARANTEES) {
    const row = plan.contract.get(guarantee.key);
    if (!row) problems.push(`plan.md: "## ${CONTRACT_HEADING}" has no row for "${guarantee.name}"`);
    else if (blank(row.how))
      problems.push(`plan.md: "${guarantee.name}" does not say how this migration keeps it`);
    else if (blank(row.checkedBy))
      problems.push(`plan.md: "${guarantee.name}" does not say what checks it`);
    else if (/\]\(#/.test(`${row.how} ${row.checkedBy}`))
      problems.push(
        `plan.md: "${guarantee.name}" links to a bare #anchor; the README shows this row too, so link as ./plan.md#anchor`
      );
  }
  const progressIds = [...progress.steps.keys()];
  if (progressIds.join(',') !== ids.join(','))
    problems.push(
      `progress.md steps do not match plan.md steps in order (plan: ${ids.length}, progress: ${progressIds.length})`
    );
  for (const step of plan.steps) {
    if (!step.risk)
      problems.push(`plan.md: ${step.id} has no risk rating (**Low**, **Medium** or **High**)`);
    const scope = plan.scopes.get(step.id);
    if (!scope) problems.push(`plan.md: ${step.id} has no row in "## ${SCOPES_HEADING}"`);
    else if (!KINDS.includes(scope.kind))
      problems.push(
        `plan.md: ${step.id} scope kind "${scope.kind}" is not one of ${KINDS.join(', ')}`
      );
    else if (['PR', 'Docs'].includes(scope.kind) && scope.files.length === 0)
      problems.push(`plan.md: ${step.id} is a ${scope.kind} step with no files in its scope`);
    if (scope && plan.prodPath.length && touchesProdPath(scope.files, plan.prodPath)) {
      if (!scope.human)
        problems.push(`plan.md: ${step.id} touches the prod path but is not marked Human`);
      if (!scope.doneNeedsProd)
        problems.push(
          `plan.md: ${step.id} touches the prod path but is not marked Done needs prod`
        );
    }
    if (scope && step.writesLive && !scope.human)
      problems.push(`plan.md: ${step.id} writes to a live system but is not marked Human`);
    if (blank(wayBackOf(plan, step)))
      problems.push(
        `plan.md: ${step.id} has no way back (a "Way back" cell in "## ${SCOPES_HEADING}", or its phase's row in the phases table)`
      );
    for (const partner of step.parallelWith)
      if (!seen.has(partner))
        problems.push(`plan.md: ${step.id} is parallel with unknown ${partner}`);
  }
  for (const id of plan.scopes.keys())
    if (!seen.has(id)) problems.push(`plan.md: scope row ${id} names no step`);
  const analysis = analyse(plan, progress);
  for (const [id, row] of progress.steps) {
    if (!STATUSES.includes(row.status))
      problems.push(
        `progress.md: ${id} status "${row.status}" is not one of ${STATUSES.join(', ')}`
      );
    if (row.cells.length !== row.header.length)
      problems.push(
        `progress.md: ${id} row has ${row.cells.length} cells, header has ${row.header.length}`
      );
    if (row.status === 'done' && !row.evidence)
      problems.push(`progress.md: ${id} is done with no evidence`);
    if (row.status === 'dropped' && !row.evidence)
      problems.push(`progress.md: ${id} is dropped with no evidence naming its decision`);
    const step = plan.steps.find((s) => s.id === id);
    if (!step) continue;
    if (row.risk !== undefined && step.risk && row.risk !== step.risk)
      problems.push(`progress.md: ${id} risk "${row.risk}" differs from plan.md "${step.risk}"`);
    if (['in-progress', 'blocked', 'done'].includes(row.status)) {
      const waiting = analysis.waitingOn(step);
      if (waiting.length)
        problems.push(`progress.md: ${id} is ${row.status} before ${waiting.join(', ')}`);
      const gates = analysis.unmetGates(step.phase);
      if (gates.length)
        problems.push(`progress.md: ${id} is ${row.status} before gate ${gates.join(', ')} is met`);
    }
  }
  for (const gate of progress.gates.values())
    if (gate.met && !gate.evidence)
      problems.push(`progress.md: gate ${gate.phase} is met with no evidence`);
  if (progress.steps.size > 0 && progress.gates.size === 0)
    problems.push('progress.md: no "Phase | Gate | Met | Evidence" table');
  const approved = (id, action) =>
    progress.approvals.some((row) => row.step === id && row.action === action && !blank(row.by));
  for (const step of plan.steps) {
    const status = progress.steps.get(step.id)?.status;
    const scope = plan.scopes.get(step.id);
    if (status === 'dropped' && !approved(step.id, 'drop'))
      problems.push(
        `progress.md: ${step.id} is dropped with no row in "## ${APPROVALS_HEADING}" naming the human who approved the drop`
      );
    if (
      ['in-progress', 'blocked', 'done'].includes(status) &&
      (scope?.human || step.risk !== 'Low') &&
      !approved(step.id, 'start')
    )
      problems.push(
        `progress.md: ${step.id} needs a human's approval but "## ${APPROVALS_HEADING}" names no one who approved its start`
      );
    if (
      status === 'done' &&
      step.writesLive &&
      !progress.writeLog.some((row) => row.cells.some((cell) => cell.includes(step.id)))
    )
      problems.push(
        `progress.md: ${step.id} writes to a live system and is done, but no live write log row names ${step.id}`
      );
  }
  progress.writeLog.forEach((row, i) => {
    if (blank(row.dryRun))
      problems.push(`progress.md: live write log row ${i + 1} (${row.date}) records no dry run`);
    if (blank(row.approvedBy))
      problems.push(
        `progress.md: live write log row ${i + 1} (${row.date}) names no human who approved it`
      );
  });
  return problems;
}

export function contractGaps(plan, progress) {
  const gaps = [];
  const dropped = (step) => progress?.steps.get(step.id)?.status === 'dropped';
  if (
    !plan.probes.some(
      (c) => c.id === 'remaining' && c.guarantee === 'Progress' && c.needs === 'nothing' && !c.from
    )
  )
    gaps.push(
      'no health check "remaining" (guarantee Progress, needs nothing, from start) that measures how much of the old thing is left'
    );
  for (const guarantee of GUARANTEES.filter((g) => RUNTIME_GUARANTEES.includes(g.key))) {
    if (/^not at stake\b/i.test(plain(plan.contract.get(guarantee.key)?.checkedBy))) continue;
    if (!plan.probes.some((check) => check.guarantee === guarantee.name))
      gaps.push(
        `"${guarantee.name}" has no health check (add one, or start its "Checked by" with "Not at stake:" and the reason)`
      );
  }
  const patternOf = (step) => plan.scopes.get(step.id)?.pattern ?? '';
  for (const step of plan.steps) {
    const scope = plan.scopes.get(step.id);
    if (step.risk && step.risk !== 'Low')
      gaps.push(`${step.id} is rated ${step.risk}: split it or add a safeguard until it is Low`);
    if (blank(step.proof)) gaps.push(`${step.id} names no proof`);
    if (!scope) continue;
    if (blank(scope.wayBack)) gaps.push(`${step.id} has no way back of its own`);
    if (!scope.pattern) {
      gaps.push(`${step.id} has no pattern`);
      continue;
    }
    const pattern = PATTERNS[scope.pattern];
    if (!pattern) {
      gaps.push(
        `${step.id} pattern "${scope.pattern}" is not one of ${Object.keys(PATTERNS).join(', ')}`
      );
      continue;
    }
    if (!pattern.kinds.includes(scope.kind))
      gaps.push(
        `${step.id} is a ${scope.pattern} step of kind ${scope.kind}; ${scope.pattern} is ${pattern.kinds.join(' or ')}`
      );
    if (scope.kind === 'Wait' && scope.pattern !== 'soak')
      gaps.push(`${step.id} is a Wait step, so its pattern is soak`);
    if (pattern.human && !scope.human)
      gaps.push(`${step.id} is a ${scope.pattern} step, so it is Human: yes`);
    if (scope.kind === 'Docs' && scope.files.some((file) => !file.startsWith('./')))
      gaps.push(
        `${step.id} is a Docs step, so its files are inside the migration's folder (./...)`
      );
    if (['Action', 'Wait'].includes(scope.kind) && scope.files.length)
      gaps.push(
        `${step.id} is ${scope.kind === 'Wait' ? 'a Wait' : 'an Action'} step, so it changes progress.md only and lists no files`
      );
    if (dropped(step)) continue;
    const before = plan.steps.slice(0, step.index).filter((s) => !dropped(s));
    if (scope.pattern === 'contract') {
      const last = before.findLast((s) => ['soak', ...GOES_LIVE].includes(patternOf(s)));
      if (!last) gaps.push(`${step.id} removes something with no soak before it`);
      else if (patternOf(last) !== 'soak')
        gaps.push(
          `${step.id} removes something right after ${last.id} (${patternOf(last)}) with no soak between`
        );
    }
    if (scope.pattern === 'enforce') {
      const guard = before.findIndex((s) => patternOf(s) === 'guard');
      if (guard === -1 || !before.slice(guard + 1).some((s) => patternOf(s) === 'soak'))
        gaps.push(`${step.id} makes a check blocking with no guard and soak before it`);
    }
    if (['switch', 'backfill'].includes(scope.pattern))
      if (!before.some((s) => s.phase === step.phase && patternOf(s) === 'observe'))
        gaps.push(
          `${step.id} is a ${scope.pattern} with no observe step (dry run or readiness check) before it in phase ${step.phase}`
        );
  }
  return gaps;
}

export function extractStatus(readme) {
  if (!readme) return null;
  const start = readme.indexOf(STATUS_START);
  const end = readme.indexOf(STATUS_END);
  if (start === -1 || end === -1 || end < start) return null;
  return readme.slice(start + STATUS_START.length, end).trim();
}

export function stripStatus(readme) {
  if (extractStatus(readme) === null) return readme;
  return (
    readme.slice(0, readme.indexOf(STATUS_START) + STATUS_START.length) +
    readme.slice(readme.indexOf(STATUS_END))
  );
}

export function withStatus(readme, content) {
  if (extractStatus(readme) === null) return null;
  return (
    readme.slice(0, readme.indexOf(STATUS_START) + STATUS_START.length) +
    `\n${content}\n` +
    readme.slice(readme.indexOf(STATUS_END))
  );
}

function needsOf(plan, step) {
  const scope = plan.scopes.get(step.id);
  return [
    scope?.human && "a named human's approval",
    step.risk && step.risk !== 'Low' && `a named human accepting ${step.risk} risk`
  ].filter(Boolean);
}

export function describeStep(plan, step, status) {
  const scope = plan.scopes.get(step.id);
  return {
    id: step.id,
    phase: step.phase,
    status,
    kind: scope?.kind ?? null,
    pattern: scope?.pattern || null,
    risk: step.risk,
    human: Boolean(scope?.human),
    doneNeedsProd: Boolean(scope?.doneNeedsProd),
    writesLive: step.writesLive,
    wayBack: wayBackOf(plan, step),
    needs: needsOf(plan, step)
  };
}

export function overview(plan, progress) {
  const a = analyse(plan, progress);
  const describe = (step) => describeStep(plan, step, a.statusOf(step.id));
  const total = plan.steps.length;
  const closed = plan.steps.filter((step) => a.closed(step.id)).length;
  const phases = a.phaseNumbers.map((phase) => {
    const steps = plan.steps.filter((step) => step.phase === phase);
    return {
      phase,
      name: plan.phases.get(phase) ?? '',
      total: steps.length,
      closed: steps.filter((step) => a.closed(step.id)).length,
      gate: progress.gates.get(phase)?.gate ?? '',
      gateMet: Boolean(progress.gates.get(phase)?.met),
      wayBack: plan.phaseInfo.get(phase)?.wayBack ?? ''
    };
  });
  const focus = a.current[0] ?? a.eligible[0] ?? null;
  const phase = focus?.phase ?? a.gateDue ?? null;
  const complete = total > 0 && closed === total && phases.every((p) => p.gateMet);
  const open = plan.steps.filter((step) => !a.closed(step.id));
  const risks = Object.fromEntries(
    RISKS.map((risk) => [risk, plan.steps.filter((step) => step.risk === risk).length])
  );
  return {
    total,
    closed,
    percent: total ? Math.round((closed / total) * 100) : 0,
    complete,
    phase,
    phaseName: phase === null ? null : (plan.phases.get(phase) ?? ''),
    phases,
    current: a.current.map(describe),
    eligible: a.eligible.map(describe),
    upcoming: open
      .filter((step) => !a.current.includes(step) && !a.eligible.includes(step))
      .slice(0, 5)
      .map(describe),
    gateDue: a.gateDue ?? null,
    wayBackNow: focus
      ? wayBackOf(plan, focus)
      : phase === null
        ? ''
        : (plan.phaseInfo.get(phase)?.wayBack ?? ''),
    risks,
    human: plan.steps.filter((step) => plan.scopes.get(step.id)?.human).length,
    prodProven: plan.steps.filter((step) => plan.scopes.get(step.id)?.doneNeedsProd).length,
    liveWriteSteps: plan.steps.filter((step) => step.writesLive).length,
    liveWrites: progress.writeLog.length,
    lastLiveWrite: progress.writeLog.at(-1)?.date ?? null,
    decisions: progress.sections.get('Decision log') ?? 0,
    openQuestions: progress.sections.get('Open questions') ?? 0,
    evidence: progress.sections.get('Evidence log') ?? 0,
    blockers: progress.blockers,
    lastUpdated: progress.now.get('last updated')?.cells[1] ?? ''
  };
}

function label(step) {
  return `${step.id} (${[step.pattern, step.kind, step.risk].filter(Boolean).join(', ')})`;
}

export function nextLabel(o) {
  if (o.current.length) return o.current.map((s) => `${s.id} (${s.status})`).join(', ');
  if (o.eligible.length) return o.eligible.map((s) => s.id).join(' or ');
  if (o.gateDue !== null) return `gate ${o.gateDue} (record its evidence)`;
  return o.complete ? 'none: the migration is complete' : 'none: every step is closed';
}

export function renderStatus(programme) {
  const { plan, progress } = programme;
  const o = overview(plan, progress);
  const next = o.current[0] ?? o.eligible[0];
  const headline = o.complete
    ? `**Complete.** All ${o.total} steps are closed and every gate is met.`
    : `**${o.closed} of ${o.total} steps closed (${o.percent}%).** ${o.phase === null ? 'No step is open.' : `Phase ${o.phase}: ${o.phaseName}.`}`;
  const risks = RISKS.filter((risk) => o.risks[risk]).map((risk) => `${o.risks[risk]} ${risk}`);
  return [
    '<!-- prettier-ignore-start -->',
    '',
    `> Generated from plan.md and progress.md by \`safe-migration render\`. Never edit by hand.`,
    '',
    headline,
    '',
    formatTable(
      ['Now', ''],
      [
        ['In progress', o.current.length ? o.current.map(label).join(', ') : 'nothing'],
        ['Next', nextLabel(o)],
        [
          'Needs before it starts',
          next && next.status === 'todo' && next.needs.length ? next.needs.join('; ') : 'nothing'
        ],
        ['Way back right now', o.wayBackNow || 'n/a'],
        ['Blockers', o.blockers ? o.blockers.replace(/\n/g, ' ') : 'none'],
        ['Risk ratings', risks.join(', ') || 'none rated'],
        ['Live writes logged', String(o.liveWrites)],
        ['Last updated', o.lastUpdated]
      ]
    ),
    '',
    formatTable(
      ['Phase', 'Steps closed', 'Gate met', 'Way back'],
      o.phases.map((p) => [
        `${p.phase}: ${p.name}`,
        `${p.closed}/${p.total}`,
        p.gateMet ? 'yes' : 'no',
        p.wayBack
      ])
    ),
    '',
    formatTable(
      ['Guarantee', 'How this migration keeps it', 'Checked by'],
      GUARANTEES.map((g) => [
        g.name,
        plan.contract.get(g.key)?.how ?? '',
        plan.contract.get(g.key)?.checkedBy ?? ''
      ])
    ),
    '',
    `Everything else (findings, approvals ahead, logs, health checks): \`safe-migration health ${programme.name}\`, the script of the [safe-migration skill](${DOCS_URL}/SKILL.md).`,
    '',
    '<!-- prettier-ignore-end -->'
  ].join('\n');
}

function stem(name) {
  return name.replace(/\.[^.]+$/, '');
}

export function checkStates(programme, progress = programme.progress) {
  const a = analyse(programme.plan, progress);
  return programme.plan.probes.map((check) => ({
    ...check,
    file: programme.checkFiles.find((file) => stem(file.name) === check.id)?.name ?? null,
    active: !check.from || a.closed(check.from)
  }));
}

export function checkProblems(programme) {
  const problems = [];
  const ids = new Set(programme.plan.probes.map((check) => check.id));
  for (const file of programme.checkFiles) {
    const extension = file.name.includes('.') ? file.name.split('.').at(-1) : '';
    if (!CHECK_RUNNERS[extension])
      problems.push(`${CHECKS_DIR}/${file.name}: a check is a .mjs, .ts or .sh script`);
    else if (!ids.has(stem(file.name)))
      problems.push(
        `${CHECKS_DIR}/${file.name}: no row named ${stem(file.name)} in "## ${HEALTH_HEADING}" of plan.md`
      );
    if (file.text?.includes(PLACEHOLDER))
      problems.push(`${CHECKS_DIR}/${file.name}: still holds a ${PLACEHOLDER}...) placeholder`);
  }
  for (const check of checkStates(programme)) {
    const scripts = programme.checkFiles.filter((file) => stem(file.name) === check.id).length;
    if (scripts > 1) problems.push(`${CHECKS_DIR}/: ${check.id} has ${scripts} scripts`);
    if (check.active && !check.file)
      problems.push(
        `${CHECKS_DIR}/: health check ${check.id} is active (${check.from ? `${check.from} is closed` : 'from the start'}) but has no script ${CHECKS_DIR}/${check.id}.mjs`
      );
  }
  return problems;
}

export function docProblems(programme) {
  const problems = [];
  for (const name of REQUIRED_FILES)
    if (programme.docs[name] === null || programme.docs[name] === undefined)
      problems.push(`${name}: missing`);
  for (const [name, text] of Object.entries(programme.docs))
    if (!['plan.md', 'progress.md'].includes(name) && text?.includes(PLACEHOLDER))
      problems.push(`${name}: still holds a ${PLACEHOLDER}...) placeholder`);
  if (programme.readmeText !== null) {
    const current = extractStatus(programme.readmeText);
    if (current === null)
      problems.push(
        `README.md: no status block (add the lines ${STATUS_START} and ${STATUS_END}, then run "render")`
      );
    else if (current !== renderStatus(programme))
      problems.push(
        `README.md: the status block is out of date (run "safe-migration render ${programme.name}")`
      );
  }
  problems.push(...checkProblems(programme));
  return problems;
}

export function structureGaps(programme) {
  const gaps = [];
  for (const entry of programme.entries)
    if (!ALLOWED_ENTRIES.includes(entry))
      gaps.push(
        `${entry} does not belong in the folder: a migration holds ${ALLOWED_ENTRIES.join(', ')} and nothing else`
      );
  for (const [file, sections] of Object.entries(REQUIRED_SECTIONS)) {
    const text = programme.docs[file];
    if (text === null || text === undefined) continue;
    const have = new Set(
      text
        .split('\n')
        .filter((line) => line.startsWith('## '))
        .map((line) => line.slice(3).trim())
    );
    for (const section of sections)
      if (!have.has(section)) gaps.push(`${file} has no "## ${section}" section`);
  }
  const phases = [...new Set(programme.plan.steps.map((step) => step.phase))];
  if (phases.some((phase, i) => phase !== i))
    gaps.push(`phases are numbered ${phases.join(', ')}; number them 0, 1, 2 with none skipped`);
  for (const phase of phases) {
    const numbers = programme.plan.steps
      .filter((step) => step.phase === phase)
      .map((step) => Number(step.id.split('.')[1]));
    if (numbers.some((number, i) => number !== i + 1))
      gaps.push(`phase ${phase} steps are numbered ${numbers.join(', ')}; number them 1, 2, 3`);
  }
  return gaps;
}

export function allGaps(programme) {
  return [...contractGaps(programme.plan, programme.progress), ...structureGaps(programme)];
}

export function renderIndex(programmes) {
  const rows = programmes.map((programme) => [
    `[${programme.name}](./${programme.name}/README.md)`,
    programme.title,
    `\`safe-migration health ${programme.name}\``
  ]);
  return [
    '# Safe migrations',
    '',
    '<!-- prettier-ignore-start -->',
    '',
    '> Generated by `safe-migration render`. Never edit by hand.',
    '',
    'Every multi-PR migration lives here, one folder each, always the same shape:',
    '',
    '```text',
    `${MIGRATIONS_DIR}/<name>/`,
    '  README.md     start here: goal, rules in one screen, generated status',
    '  plan.md       the safety contract and every step: work, proof, risk, pattern, way back, files',
    "  progress.md   each step's status, gates, blockers, decisions, the live write log, evidence",
    '  safety.md     the facts the plan depends on, invariants, failure modes, the way back',
    `  ${CHECKS_DIR}/       one read-only script per health check: exit 0 is healthy, last line is the reading`,
    '```',
    '',
    rows.length
      ? formatTable(['Migration', 'What', 'Where it stands'], rows)
      : 'No migrations yet.',
    '',
    `Run one with the [safe-migration skill](${DOCS_URL}/SKILL.md). Its script's \`next <name>\` says exactly what to do now; \`health\` reports everything about every migration.`,
    '',
    '<!-- prettier-ignore-end -->',
    ''
  ].join('\n');
}

function daysBetween(from, to) {
  const start = Date.parse(`${String(from).slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${String(to).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(start) || Number.isNaN(end) ? null : Math.round((end - start) / 86400000);
}

export function healthReport(programme, { date = today(), staleDays = STALE_DAYS } = {}) {
  const { plan, progress } = programme;
  const o = overview(plan, progress);
  const findings = [];
  const add = (severity, area, message) => findings.push({ severity, area, message });
  for (const problem of validate(plan, progress)) add('fail', 'consistency', problem);
  for (const problem of docProblems(programme)) add('fail', 'docs', problem);
  const gaps = allGaps(programme);
  if (programme.legacy) {
    if (gaps.length)
      add(
        'warn',
        'contract',
        `${gaps.length} gap(s) against the full safety contract (older format; "validate --strict" lists them)`
      );
  } else for (const gap of gaps) add('fail', 'contract', gap);
  if (o.blockers) add('warn', 'blockers', o.blockers.replace(/\n/g, ' '));
  for (const step of o.current) {
    const row = progress.steps.get(step.id);
    const age = daysBetween(row.updated, date);
    if (step.status === 'in-progress' && age !== null && age > staleDays)
      add('warn', 'freshness', `${step.id} has been in progress for ${age} days with no update`);
    if (step.status === 'in-progress' && step.kind === 'PR' && !row.pr)
      add('info', 'tracking', `${step.id} is in progress with no PR linked yet`);
    if (step.status === 'in-progress' && step.doneNeedsProd && row.pr)
      add('info', 'tracking', `${step.id} is done only once a prod run proves it`);
  }
  if (o.gateDue !== null)
    add('warn', 'gates', `every step of phase ${o.gateDue} is closed: prove and record its gate`);
  const fails = findings.filter((f) => f.severity === 'fail').length;
  const warns = findings.filter((f) => f.severity === 'warn').length;
  return {
    migration: programme.programme,
    title: programme.title,
    legacy: programme.legacy,
    verdict: fails ? 'UNSAFE' : warns ? 'ATTENTION' : o.complete ? 'COMPLETE' : 'HEALTHY',
    fails,
    warns,
    ...o,
    next: nextLabel(o),
    guarantees: GUARANTEES.map((g) => ({
      key: g.key,
      name: g.name,
      how: plan.contract.get(g.key)?.how ?? '',
      checkedBy: plan.contract.get(g.key)?.checkedBy ?? ''
    })),
    contractGaps: gaps,
    checks: checkStates(programme),
    findings
  };
}

export function setCells(lines, row, updates) {
  const cells = [...row.cells];
  for (const [name, value] of Object.entries(updates)) {
    const i = column(row.header, name);
    if (i === -1) throw new Error(`progress.md has no "${name}" column for ${row.cells[0]}`);
    cells[i] = escapeCell(value);
  }
  lines[row.index] = formatRow(cells);
}

export function setNow(lines, progress, key, value) {
  const row = progress.now.get(key.toLowerCase());
  if (!row) return false;
  const cells = [...row.cells];
  cells[1] = escapeCell(value);
  lines[row.index] = formatRow(cells);
  return true;
}

export function setBlocker(lines, id, text) {
  const section = sectionText(lines, 'Blockers');
  if (!section) throw new Error('progress.md has no "## Blockers" section');
  const bullets = section.body && !/^none\.?$/i.test(section.body) ? section.body.split('\n') : [];
  const kept = bullets.filter((line) => !line.startsWith(`- **${id}**`));
  if (text) kept.push(`- **${id}**: ${text.replace(/\r?\n/g, ' ')}`);
  const body = kept.length ? kept.join('\n') : 'None.';
  lines.splice(section.start + 1, section.end - section.start - 1, '', body, '');
}

export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (char === '*') out += '[^/]*';
    else if (char === '?') out += '[^/]';
    else out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

function segmentsOverlap(a, b) {
  const wild = (segment) => /[*?]/.test(segment);
  if (!wild(a) && !wild(b)) return a === b;
  if (!wild(b)) return globToRegExp(a).test(b);
  if (!wild(a)) return globToRegExp(b).test(a);
  const head = (segment) => segment.slice(0, segment.search(/[*?]/));
  const tail = (segment) =>
    segment.slice(Math.max(segment.lastIndexOf('*'), segment.lastIndexOf('?')) + 1);
  const agree = (x, y) => x.startsWith(y) || y.startsWith(x);
  const ends = (x, y) => x.endsWith(y) || y.endsWith(x);
  return agree(head(a), head(b)) && ends(tail(a), tail(b));
}

export function globsOverlap(a, b) {
  const walk = (x, y) => {
    if (!x.length && !y.length) return true;
    if (x[0] === '**') return walk(x.slice(1), y) || (y.length > 0 && walk(x, y.slice(1)));
    if (y[0] === '**') return walk(x, y.slice(1)) || (x.length > 0 && walk(x.slice(1), y));
    if (!x.length || !y.length) return false;
    return segmentsOverlap(x[0], y[0]) && walk(x.slice(1), y.slice(1));
  };
  return walk(a.split('/'), b.split('/'));
}

export function touchesProdPath(files, prodPath) {
  return files.some((file) => prodPath.some((glob) => globsOverlap(file, glob)));
}

export function matchesAny(file, globs) {
  return globs.some((glob) => globToRegExp(glob).test(file));
}

export function resolveScope(scope, programme) {
  return scope.files.map((file) =>
    file.startsWith('./') ? posix.join(programme, file.slice(2)) : file
  );
}

export function normalizedRows(progress) {
  const rows = new Map();
  for (const [id, row] of progress.steps) rows.set(id, row.cells.join(' | '));
  return rows;
}

export function disciplineProblems(baseText, currentText, stepId, phase) {
  const problems = [];
  if (baseText === null) return problems;
  const base = parseProgress(baseText);
  const current = parseProgress(currentText);
  const before = normalizedRows(base);
  const after = normalizedRows(current);
  for (const [id, row] of before)
    if (id !== stepId && after.get(id) !== row)
      problems.push(`progress.md: row ${id} changed; only ${stepId} may change`);
  for (const [phaseNumber, gate] of base.gates) {
    const now = current.gates.get(phaseNumber);
    if (phaseNumber !== phase && now && now.cells.join(' | ') !== gate.cells.join(' | '))
      problems.push(
        `progress.md: gate ${phaseNumber} changed; only gate ${phase} may change with ${stepId}`
      );
  }
  for (const [section, rows] of base.logs) {
    const kept = new Set(current.logs.get(section) ?? []);
    for (const row of rows)
      if (!kept.has(row))
        problems.push(`progress.md: "${section}" is append-only; a row was changed or removed`);
  }
  return problems;
}

export function amendmentProblems(baseText, currentText) {
  const problems = [];
  if (baseText === null) return problems;
  const base = parseProgress(baseText);
  const current = parseProgress(currentText);
  for (const [id, row] of current.steps) {
    const before = base.steps.get(id);
    if (!before) {
      if (row.status !== 'todo')
        problems.push(
          `progress.md: new step ${id} is ${row.status}; an amendment adds steps as todo`
        );
      continue;
    }
    const blocking = row.status === 'blocked' && ['in-progress', 'blocked'].includes(before.status);
    if (row.status !== before.status && !blocking)
      problems.push(
        `progress.md: ${id} went from ${before.status} to ${row.status}; an amendment never changes a step's status`
      );
    if (row.evidence !== before.evidence || row.pr !== before.pr)
      problems.push(
        `progress.md: ${id} evidence or PR changed; an amendment never rewrites the record`
      );
  }
  for (const [phase, gate] of base.gates) {
    const now = current.gates.get(phase);
    if (now && (now.met !== gate.met || now.evidence !== gate.evidence))
      problems.push(`progress.md: gate ${phase} changed; an amendment never records a gate`);
  }
  for (const [section, rows] of base.logs) {
    const kept = new Set(current.logs.get(section) ?? []);
    for (const row of rows)
      if (!kept.has(row))
        problems.push(`progress.md: "${section}" is append-only; a row was changed or removed`);
  }
  return problems;
}

export function appendRow(lines, section, cells) {
  const { tables } = readTables(lines.join('\n'));
  const table = tables.find((candidate) => candidate.section === section);
  if (!table || table.separatorIndex === undefined)
    throw new Error(`progress.md has no table under "## ${section}"`);
  if (cells.length !== table.header.length)
    throw new Error(`"## ${section}" has ${table.header.length} columns; ${cells.length} given`);
  const at = (table.rows.at(-1)?.index ?? table.separatorIndex) + 1;
  lines.splice(at, 0, formatRow(cells.map((cell) => escapeCell(cell))));
}

export function syncNow(lines, plan) {
  const progress = parseProgress(lines.join('\n'));
  const o = overview(plan, progress);
  setNow(lines, progress, 'Next step', nextLabel(o));
  if (o.phase !== null) setNow(lines, progress, 'Current phase', `${o.phase}: ${o.phaseName}`);
  else if (o.complete) setNow(lines, progress, 'Current phase', 'complete');
}

export function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

export function repoRoot(cwd = process.cwd()) {
  return git(['rev-parse', '--show-toplevel'], cwd);
}

export function readFrom(root, path, ref) {
  if (!ref) {
    const abs = join(root, path);
    return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  }
  try {
    return git(['show', `${ref}:${path}`], root) + '\n';
  } catch {
    return null;
  }
}

export function legacyMigrations(root) {
  const text = readFrom(root, LEGACY_PATH);
  if (text === null) return [];
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string'))
    throw new Error(`${LEGACY_PATH} must be a JSON array of migration names`);
  return parsed;
}

export function migrationDir(arg) {
  const trimmed = String(arg).replace(/\/+$/, '');
  const name = trimmed.startsWith(`${MIGRATIONS_DIR}/`)
    ? trimmed.slice(MIGRATIONS_DIR.length + 1)
    : trimmed;
  if (!MIGRATION_NAME.test(name))
    throw new Error(
      `"${arg}" is not a migration: every migration is ${MIGRATIONS_DIR}/<name>, with a lowercase-dashed name`
    );
  return `${MIGRATIONS_DIR}/${name}`;
}

function listEntries(root, programme, ref) {
  if (!ref) return readdirSync(join(root, programme)).sort();
  try {
    return git(['ls-tree', '--name-only', `${ref}:${programme}`], root)
      .split('\n')
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

function listChecks(root, programme, ref) {
  const dir = `${programme}/${CHECKS_DIR}`;
  let names = [];
  if (ref) {
    try {
      names = git(['ls-tree', '--name-only', `${ref}:${dir}`], root)
        .split('\n')
        .filter(Boolean);
    } catch {
      names = [];
    }
  } else if (existsSync(join(root, dir)))
    names = readdirSync(join(root, dir)).filter((name) => statSync(join(root, dir, name)).isFile());
  return names.sort().map((name) => ({ name, text: readFrom(root, `${dir}/${name}`, ref) }));
}

export function loadProgramme(root, arg, ref) {
  const programme = migrationDir(arg);
  const planText = readFrom(root, `${programme}/plan.md`, ref);
  const progressText = readFrom(root, `${programme}/progress.md`, ref);
  if (planText === null)
    throw new Error(`${programme}/plan.md not found${ref ? ` at ${ref}` : ''}`);
  if (progressText === null)
    throw new Error(`${programme}/progress.md not found${ref ? ` at ${ref}` : ''}`);
  const readmeText = readFrom(root, `${programme}/README.md`, ref);
  const name = basename(programme);
  return {
    programme,
    name,
    title: (readmeText && /^# (.+)$/m.exec(readmeText)?.[1]) || name,
    planText,
    progressText,
    readmeText,
    docs: {
      'README.md': readmeText,
      'plan.md': planText,
      'progress.md': progressText,
      'safety.md': readFrom(root, `${programme}/safety.md`, ref),
      'design.md': readFrom(root, `${programme}/design.md`, ref)
    },
    entries: listEntries(root, programme, ref),
    checkFiles: listChecks(root, programme, ref),
    legacy: legacyMigrations(root).includes(name),
    plan: parsePlan(planText),
    progress: parseProgress(progressText)
  };
}

export function findProgrammes(root, ref) {
  let names = [];
  if (ref) {
    try {
      names = git(['ls-tree', '-d', '--name-only', `${ref}:${MIGRATIONS_DIR}`], root)
        .split('\n')
        .filter(Boolean);
    } catch {
      names = [];
    }
  } else if (existsSync(join(root, MIGRATIONS_DIR)))
    names = readdirSync(join(root, MIGRATIONS_DIR)).filter((name) =>
      existsSync(join(root, MIGRATIONS_DIR, name, 'plan.md'))
    );
  return names.sort().map((name) => `${MIGRATIONS_DIR}/${name}`);
}

export function changedFiles(root, base) {
  const mergeBase = git(['merge-base', base, 'HEAD'], root);
  const files = new Set();
  const add = (out) =>
    out
      .split('\n')
      .filter(Boolean)
      .forEach((file) => files.add(file));
  add(git(['diff', '--name-only', '--no-renames', mergeBase, 'HEAD'], root));
  add(git(['diff', '--name-only', '--no-renames', '--cached'], root));
  add(git(['diff', '--name-only', '--no-renames'], root));
  add(git(['ls-files', '--others', '--exclude-standard'], root));
  return { mergeBase, files: [...files].sort() };
}

export function changedLines(root, mergeBase, exclude) {
  const out = git(['diff', '--numstat', '--no-renames', mergeBase], root);
  let lines = 0;
  for (const row of out.split('\n').filter(Boolean)) {
    const [added, removed, file] = row.split('\t');
    if (added === '-' || matchesAny(file, exclude)) continue;
    lines += Number(added) + Number(removed);
  }
  return lines;
}
