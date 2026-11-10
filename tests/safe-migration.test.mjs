// Offline behaviour tests for the safe-migration skill: the parser and contract rules as units, and
// the script end to end in temporary Git repositories. Nothing here contacts a network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, describe, test } from 'node:test';
import {
  amendmentProblems,
  analyse,
  checkProblems,
  checkStates,
  contractGaps,
  disciplineProblems,
  docProblems,
  globsOverlap,
  GUARANTEES,
  healthReport,
  LEGACY_PATH,
  matchesAny,
  migrationDir,
  parsePlan,
  parseProgress,
  PATTERNS,
  renderIndex,
  renderStatus,
  REQUIRED_SECTIONS,
  STATUS_END,
  STATUS_START,
  stripStatus,
  structureGaps,
  validate,
  withStatus
} from '../skills/safe-migration/scripts/lib.mjs';
const root = resolve(import.meta.dirname, '..');
const script = join(root, 'skills/safe-migration/scripts/safe-migration.mjs');
const HOME = '.safe-migrations/p';
const CONTRACT = `## Safety contract

| Guarantee            | How this migration keeps it | Checked by           |
| -------------------- | --------------------------- | -------------------- |
| Zero downtime        | no locks                    | the up check         |
| Zero data loss       | dual write first            | the parity check     |
| Backwards compatible | expand then contract        | Not at stake: no API |
| Small uniform steps  | one PR per step             | validate             |
| Low risk             | every step Low              | validate             |
`;
const CHECKS = `## Health checks

| Check     | Proves           | Guarantee      | Needs     | From  |
| --------- | ---------------- | -------------- | --------- | ----- |
| remaining | what is left     | Progress       | nothing   | start |
| up        | nothing is down  | Zero downtime  | nothing   | T-0.1 |
| parity    | old equals new   | Zero data loss | prod read | T-1.1 |
`;
const PLAN = `# Plan

${CONTRACT}
## How risk is rated

Low only.

## Phases at a glance

| Phase | Name   | Way back     |
| ----- | ------ | ------------ |
| 0     | First  | \`git revert\` |
| 1     | Second | switch back  |

## Phase 0: First

| Step  | Work                          | Proof | Risk        |
| ----- | ----------------------------- | ----- | ----------- |
| T-0.1 | a                             | p     | **Low**. x  |
| T-0.2 | b _(parallel with T-0.3)_     | p     | **Low**. x  |
| T-0.3 | c _(parallel with T-0.2)_     | p     | **Low**. x  |

## Phase 1: Second

| Step  | Work | Proof | Live write | Risk       |
| ----- | ---- | ----- | ---------- | ---------- |
| T-1.1 | d    | p     | No         | **Low**. x |
| T-1.2 | e    | p     | No         | **Low**. x |

## Prod path

None.

${CHECKS}
## Step scopes

| Step  | Kind   | Pattern | Human | Done needs prod | Way back        | Files        |
| ----- | ------ | ------- | ----- | --------------- | --------------- | ------------ |
| T-0.1 | PR     | expand  | no    | no              | revert          | \`src/**\`     |
| T-0.2 | Docs   | decide  | no    | no              | nothing to undo | \`./notes.md\` |
| T-0.3 | Action | observe | yes   | no              | nothing to undo | none         |
| T-1.1 | PR     | move    | no    | yes             | revert          | \`src/a.ts\`   |
| T-1.2 | PR     | cleanup | no    | no              | revert          | \`src/b.ts\`   |
`;
const MEDIUM_PLAN = PLAN.replace(
  '| T-1.2 | e    | p     | No         | **Low**. x |',
  () => '| T-1.2 | e    | p     | No         | **Medium**. x |'
);
const progress = (statuses = {}, gate0 = 'no', extra = {}) => {
  const row = (id) =>
    `| ${id} | w | ${statuses[id] ?? 'todo'} |  |  | ${statuses[id] === 'done' ? 'proof' : ''} | ${statuses[id] === 'in-progress' ? (extra.updated ?? '') : ''} |`;
  const gate1 = extra.gate1 ?? 'no';
  const approvals = extra.noApprovals
    ? []
    : [
        ...(['in-progress', 'blocked', 'done'].includes(statuses['T-0.3'] ?? '')
          ? ['| 2026-01-01 | T-0.3 | start | Ada |']
          : []),
        ...Object.entries(statuses)
          .filter(([, status]) => status === 'dropped')
          .map(([id]) => `| 2026-01-01 | ${id} | drop | Ada |`),
        ...(extra.approvals ? [extra.approvals] : [])
      ];
  return `# Progress

## Now

| Field         | Value    |
| ------------- | -------- |
| Current phase | 0: First |
| Next step     | T-0.1    |
| Last updated  | x        |

## How to update this file

The script writes it.

## Blockers

None.

## Phase gates

| Phase | Gate | Met | Evidence |
| ----- | ---- | --- | -------- |
| 0     | g    | ${gate0} | ${gate0 === 'yes' ? 'link' : ''} |
| 1     | g    | ${gate1} | ${gate1 === 'yes' ? 'link' : ''} |

## Steps

| Step | Work | Status | PR | Ticket | Evidence | Updated |
| ---- | ---- | ------ | -- | ------ | -------- | ------- |
${['T-0.1', 'T-0.2', 'T-0.3', 'T-1.1', 'T-1.2'].map(row).join('\n')}

## Approvals

| Date (UTC) | Step | Action | Approved by |
| ---------- | ---- | ------ | ----------- |
${approvals.join('\n')}

## Decision log

| Id  | Decision |
| --- | -------- |
| D-1 | keep     |

## Open questions

None.

## Live write log

| Date (UTC) | Step | Target | Command | Dry run | Approved by | Result |
| ---------- | ---- | ------ | ------- | ------- | ----------- | ------ |
${extra.writeLog ?? ''}

## Evidence log

| Date (UTC) | Step | What | Link |
| ---------- | ---- | ---- | ---- |
`;
};
const README = `# Test migration

## Status

${STATUS_START}
${STATUS_END}

## Goal

Move a to b.

## Files

Four files and checks.

## The rules in one screen

- S1 keep it safe.

## How agents work on this

Run next.
`;
const SAFETY = REQUIRED_SECTIONS['safety.md']
  .map(
    (name) => `## ${name}

x
`
  )
  .join('\n');
const PASSING = "process.stdout.write('3 left\\n');\n";
const FAILING = "process.stdout.write('rows differ\\n');\nprocess.exit(1);\n";
const CHECK_FILES = ['remaining', 'up', 'parity'].map((id) => ({
  name: `${id}.mjs`,
  text: PASSING
}));
const programmeOf = (planText, progressText, legacy = false) => {
  const base = {
    programme: HOME,
    name: 'p',
    title: 'Test migration',
    legacy,
    planText,
    progressText,
    plan: parsePlan(planText),
    progress: parseProgress(progressText),
    readmeText: README,
    checkFiles: CHECK_FILES,
    entries: ['README.md', 'checks', 'plan.md', 'progress.md', 'safety.md'],
    docs: {}
  };
  const readmeText = withStatus(README, renderStatus(base));
  return {
    ...base,
    readmeText,
    docs: {
      'README.md': readmeText,
      'plan.md': planText,
      'progress.md': progressText,
      'safety.md': SAFETY
    }
  };
};
const KIND_OF = { soak: 'Wait', decide: 'Docs', observe: 'Action' };
const patternPlan = (patterns, phaseOf = () => 0) => {
  const ids = patterns.map((_, i) => {
    const phase = phaseOf(i);
    const position = patterns.slice(0, i + 1).filter((__, j) => phaseOf(j) === phase).length;
    return `Q-${phase}.${position}`;
  });
  const steps = ids.map((id) => `| ${id} | w | p | **Low**. x |`).join('\n');
  const scopes = ids
    .map((id, i) => {
      const pattern = patterns[i] ?? '';
      const kind = KIND_OF[pattern] ?? 'PR';
      const human = PATTERNS[pattern]?.human ? 'yes' : 'no';
      const files = kind === 'PR' ? '`src/**`' : kind === 'Docs' ? '`./notes.md`' : 'none';
      return `| ${id} | ${kind} | ${pattern} | ${human} | no | revert | ${files} |`;
    })
    .join('\n');
  return parsePlan(`# Plan

${CONTRACT}
## Steps

| Step | Work | Proof | Risk |
| ---- | ---- | ----- | ---- |
${steps}

${CHECKS.replace(/T-0\.1|T-1\.1/g, 'Q-0.1')}
## Step scopes

| Step | Kind | Pattern | Human | Done needs prod | Way back | Files |
| ---- | ---- | ------- | ----- | --------------- | -------- | ----- |
${scopes}
`);
};
const run = (cwd, ...args) => spawnSync('node', [script, ...args], { cwd, encoding: 'utf8' });
const scratchRepo = (prefix, planText, progressText, checks = {}, legacy = false) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '-q', '-b', 'dev');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  mkdirSync(join(dir, HOME, 'checks'), { recursive: true });
  writeFileSync(join(dir, HOME, 'plan.md'), planText);
  writeFileSync(join(dir, HOME, 'progress.md'), progressText);
  writeFileSync(join(dir, HOME, 'README.md'), README);
  writeFileSync(join(dir, HOME, 'safety.md'), SAFETY);
  for (const { name } of CHECK_FILES)
    writeFileSync(join(dir, HOME, 'checks', name), checks[name] ?? PASSING);
  if (legacy) {
    writeFileSync(join(dir, LEGACY_PATH), '["p"]\n');
  }
  const rendered = run(dir, 'render');
  assert.equal(rendered.status, 0, rendered.stderr);
  return { dir, git };
};
describe('safe-migration', () => {
  test('the script documents itself and finds nothing in a repository with no migrations', () => {
    const help = run(root, '--help');
    assert.equal(help.status, 0);
    assert.match(help.stdout, /next +<name>/);
    assert.equal(run(root, 'validate', '--all').status, 0);
    assert.match(run(root, 'list').stdout, /No migrations in \.safe-migrations\//);
  });
  test('a migration is always .safe-migrations/<name>', () => {
    assert.equal(migrationDir('orders'), '.safe-migrations/orders');
    assert.equal(migrationDir('.safe-migrations/orders/'), '.safe-migrations/orders');
    assert.throws(() => migrationDir('docs/orders'), /every migration is/);
    assert.throws(() => migrationDir('Orders Move'), /lowercase-dashed/);
  });
  test('the next step is the first open one, with parallel partners and gates respected', () => {
    const plan = parsePlan(PLAN);
    assert.deepEqual(
      analyse(plan, parseProgress(progress())).eligible.map((s) => s.id),
      ['T-0.1']
    );
    assert.deepEqual(
      analyse(plan, parseProgress(progress({ 'T-0.1': 'done' }))).eligible.map((s) => s.id),
      ['T-0.2', 'T-0.3']
    );
    const allOfPhase0 = { 'T-0.1': 'done', 'T-0.2': 'done', 'T-0.3': 'done' };
    const gated = analyse(plan, parseProgress(progress(allOfPhase0)));
    assert.deepEqual(gated.eligible, []);
    assert.equal(gated.gateDue, 0);
    assert.deepEqual(
      analyse(plan, parseProgress(progress(allOfPhase0, 'yes'))).eligible.map((s) => s.id),
      ['T-1.1']
    );
  });
  test('validate catches steps out of order, done without evidence and missing scopes', () => {
    const plan = parsePlan(PLAN);
    assert.deepEqual(validate(plan, parseProgress(progress())), []);
    const outOfOrder = validate(plan, parseProgress(progress({ 'T-1.1': 'in-progress' })));
    assert.ok(outOfOrder.some((p) => p.includes('T-1.1 is in-progress before T-0.1')));
    assert.ok(outOfOrder.some((p) => p.includes('gate 0')));
    const noEvidence = progress({ 'T-0.1': 'done' }).replace('| proof |', '|  |');
    assert.ok(
      validate(plan, parseProgress(noEvidence)).some((p) => p.includes('done with no evidence'))
    );
    const noScope = parsePlan(PLAN.replace(/^\| T-1\.2 \| PR .*$/m, ''));
    assert.ok(
      validate(noScope, parseProgress(progress())).some((p) => p.includes('T-1.2 has no row'))
    );
    const twoPrefixes = parsePlan(PLAN.replaceAll('T-1.2', 'U-1.2'));
    assert.ok(
      validate(twoPrefixes, parseProgress(progress())).some((p) =>
        p.includes('several prefixes (T, U)')
      )
    );
  });
  test('a step touching the prod path must be Human and Done needs prod', () => {
    const withProd = PLAN.replace('## Prod path\n\nNone.', '## Prod path\n\n- `src/a.ts`');
    const problems = validate(parsePlan(withProd), parseProgress(progress()));
    assert.ok(
      problems.some((p) => p.includes('T-0.1 touches the prod path but is not marked Human'))
    );
    assert.ok(
      !problems.some((p) => p.includes('T-1.1 touches the prod path but is not marked Done'))
    );
  });
  describe('the safety contract', () => {
    test('every guarantee needs a mechanism and a check', () => {
      for (const guarantee of GUARANTEES) {
        const without = PLAN.replace(new RegExp(`^\\| ${guarantee.name} .*\\n`, 'm'), '');
        assert.ok(
          validate(parsePlan(without), parseProgress(progress())).some((p) =>
            p.includes(`no row for "${guarantee.name}"`)
          ),
          guarantee.name
        );
      }
      const unchecked = PLAN.replace('| the parity check     |', '| tbd |');
      assert.ok(
        validate(parsePlan(unchecked), parseProgress(progress())).some((p) =>
          p.includes('"Zero data loss" does not say what checks it')
        )
      );
      const anchored = PLAN.replace('no locks     ', '[x](#phases)');
      assert.ok(
        validate(parsePlan(anchored), parseProgress(progress())).some((p) =>
          p.includes('bare #anchor')
        )
      );
    });
    test('every step resolves a way back, its own or its phase', () => {
      const noPhaseRow = PLAN.replace('| 1     | Second | switch back  |\n', '');
      assert.deepEqual(validate(parsePlan(noPhaseRow), parseProgress(progress())), []);
      const neither = noPhaseRow.replace(
        '| T-1.2 | PR     | cleanup | no    | no              | revert  ',
        '| T-1.2 | PR     | cleanup | no    | no              | none    '
      );
      assert.ok(
        validate(parsePlan(neither), parseProgress(progress())).some((p) =>
          p.includes('T-1.2 has no way back')
        )
      );
    });
    test('a live write needs a human, a dry run and a named approver', () => {
      const live = PLAN.replace(
        '| T-1.1 | d    | p     | No        ',
        '| T-1.1 | d | p | Yes: prod'
      );
      assert.ok(
        validate(parsePlan(live), parseProgress(progress())).some((p) =>
          p.includes('T-1.1 writes to a live system but is not marked Human')
        )
      );
      const plan = parsePlan(PLAN);
      const logged = (row) => validate(plan, parseProgress(progress({}, 'no', { writeLog: row })));
      assert.deepEqual(logged('| 2026-01-01 | T-0.3 | dev | cmd | plan output | Ada | ok |'), []);
      assert.ok(
        logged('| 2026-01-01 | T-0.3 | dev | cmd |  | Ada | ok |').some((p) =>
          p.includes('records no dry run')
        )
      );
      assert.ok(
        logged('| 2026-01-01 | T-0.3 | dev | cmd | plan output |  | ok |').some((p) =>
          p.includes('names no human')
        )
      );
    });
    test('a scaffold placeholder left in the plan is a problem', () => {
      const scaffold = PLAN.replace('| T-0.1 | a  ', '| T-0.1 | TODO(the work)');
      assert.ok(
        validate(parsePlan(scaffold), parseProgress(progress())).some((p) =>
          p.includes('placeholder')
        )
      );
    });
    test('the full contract: every step is Low with a proof, a pattern and its own way back', () => {
      assert.deepEqual(contractGaps(parsePlan(PLAN)), []);
      assert.ok(
        contractGaps(parsePlan(MEDIUM_PLAN)).some((g) => g.includes('T-1.2 is rated Medium'))
      );
      const bare = PLAN.replace(
        '| T-0.1 | a                             | p    ',
        '| T-0.1 | a | tbd'
      )
        .replace(
          '| T-0.1 | PR     | expand  | no    | no              | revert  ',
          '| T-0.1 | PR | | no | no | '
        )
        .replace('| T-0.2 | Docs   | decide ', '| T-0.2 | Docs | invent ');
      const gaps = contractGaps(parsePlan(bare));
      assert.ok(gaps.includes('T-0.1 names no proof'), gaps.join('\n'));
      assert.ok(gaps.includes('T-0.1 has no way back of its own'));
      assert.ok(gaps.includes('T-0.1 has no pattern'));
      assert.ok(gaps.some((g) => g.startsWith('T-0.2 pattern "invent" is not one of')));
    });
    test('the full contract: a progress check, and a check for every guarantee at stake', () => {
      const noRemaining = PLAN.replace(/^\| remaining .*\n/m, '');
      assert.ok(
        contractGaps(parsePlan(noRemaining)).some((g) => g.includes('no health check "remaining"'))
      );
      const noParity = PLAN.replace(/^\| parity .*\n/m, '');
      assert.ok(
        contractGaps(parsePlan(noParity)).some((g) =>
          g.startsWith('"Zero data loss" has no health check')
        )
      );
      assert.ok(!contractGaps(parsePlan(PLAN)).some((g) => g.includes('Backwards compatible')));
    });
    test('the full contract: every file has the same sections and steps are numbered in order', () => {
      assert.deepEqual(structureGaps(programmeOf(PLAN, progress())), []);
      const noSection = programmeOf(PLAN.replace('## Prod path', '## Other'), progress());
      assert.ok(structureGaps(noSection).includes('plan.md has no "## Prod path" section'));
      const stray = { ...programmeOf(PLAN, progress()), entries: ['README.md', 'notes.md'] };
      assert.ok(structureGaps(stray).some((g) => g.startsWith('notes.md does not belong')));
      const skipped = programmeOf(PLAN.replaceAll('T-1.', 'T-2.'), progress());
      assert.ok(structureGaps(skipped).some((g) => g.includes('phases are numbered 0, 2')));
      const gap = programmeOf(PLAN.replaceAll('T-1.2', 'T-1.4'), progress());
      assert.ok(structureGaps(gap).some((g) => g.includes('phase 1 steps are numbered 1, 4')));
    });
    test('pattern rules: what each kind of step must be and must follow', () => {
      const gaps = (patterns, phaseOf) => contractGaps(patternPlan(patterns, phaseOf));
      assert.deepEqual(
        gaps([
          'decide',
          'observe',
          'guard',
          'expand',
          'dual-write',
          'observe',
          'backfill',
          'observe',
          'switch',
          'soak',
          'enforce',
          'move',
          'soak',
          'contract',
          'cleanup'
        ]),
        []
      );
      assert.ok(gaps(['expand', 'contract']).some((g) => g.includes('right after Q-0.1 (expand)')));
      assert.ok(gaps(['soak', 'move', 'contract']).some((g) => g.includes('no soak between')));
      assert.ok(gaps(['contract']).some((g) => g.includes('no soak before it')));
      assert.deepEqual(gaps(['expand', 'soak', 'contract', 'contract', 'cleanup']), []);
      assert.ok(gaps(['expand', 'switch']).some((g) => g.includes('no observe step')));
      assert.ok(
        gaps(['observe', 'backfill'], (i) => i).some((g) => g.includes('before it in phase 1'))
      );
      assert.ok(gaps(['guard', 'enforce']).some((g) => g.includes('no guard and soak before it')));
      assert.ok(gaps(['soak', 'guard', 'enforce']).some((g) => g.includes('no guard and soak')));
      const unapproved = parsePlan(
        PLAN.replace('| T-0.1 | PR     | expand ', '| T-0.1 | PR     | contract')
      );
      assert.ok(contractGaps(unapproved).includes('T-0.1 is a contract step, so it is Human: yes'));
      const wait = parsePlan(
        PLAN.replace('| T-0.3 | Action | observe', '| T-0.3 | Wait   | observe')
      );
      assert.ok(contractGaps(wait).some((g) => g.includes('T-0.3 is a Wait step')));
      const soakPr = parsePlan(
        PLAN.replace('| T-1.2 | PR     | cleanup', '| T-1.2 | PR     | soak   ')
      );
      assert.ok(contractGaps(soakPr).some((g) => g.includes('T-1.2 is a soak step of kind PR')));
    });
  });
  describe('check scripts', () => {
    test('a check is active from the start, or once its From step is closed', () => {
      const states = (statuses) =>
        checkStates(programmeOf(PLAN, progress(statuses))).map((c) => [c.id, c.active, c.file]);
      assert.deepEqual(states({}), [
        ['remaining', true, 'remaining.mjs'],
        ['up', false, 'up.mjs'],
        ['parity', false, 'parity.mjs']
      ]);
      assert.deepEqual(
        states({ 'T-0.1': 'done' }).map(([, active]) => active),
        [true, true, false]
      );
    });
    test('every script has a row, every active row has a script, and none is a stub', () => {
      const base = programmeOf(PLAN, progress({ 'T-0.1': 'done' }));
      assert.deepEqual(checkProblems(base), []);
      const withFiles = (checkFiles) => checkProblems({ ...base, checkFiles });
      assert.ok(
        withFiles([...CHECK_FILES, { name: 'extra.mjs', text: PASSING }]).some((p) =>
          p.includes('checks/extra.mjs: no row named extra')
        )
      );
      assert.ok(
        withFiles([...CHECK_FILES, { name: 'notes.md', text: 'x' }]).some((p) =>
          p.includes('a check is a .mjs, .ts or .sh script')
        )
      );
      assert.ok(
        withFiles(CHECK_FILES.filter((file) => file.name !== 'up.mjs')).some((p) =>
          p.includes('health check up is active (T-0.1 is closed) but has no script')
        )
      );
      assert.deepEqual(withFiles(CHECK_FILES.filter((file) => file.name !== 'parity.mjs')), []);
      assert.ok(
        withFiles([
          { name: 'remaining.mjs', text: 'TODO(count it)' },
          ...CHECK_FILES.slice(1)
        ]).some((p) => p.includes('checks/remaining.mjs: still holds'))
      );
    });
    test('a check row names a known guarantee and a known step', () => {
      const problems = (planText) => validate(parsePlan(planText), parseProgress(progress()));
      assert.ok(
        problems(
          PLAN.replace('| Zero downtime  | nothing   | T-0.1 |', '| Speed | nothing | T-0.1 |')
        ).some((p) => p.includes('health check up guarantee "Speed" is not one of'))
      );
      assert.ok(
        problems(PLAN.replace('| nothing   | T-0.1 |', '| nothing   | T-9.9 |')).some((p) =>
          p.includes('health check up starts from unknown step T-9.9')
        )
      );
    });
  });
  describe('generated docs', () => {
    test('the README status block follows the plan and progress, and goes stale when they move', () => {
      const fresh = programmeOf(PLAN, progress());
      assert.deepEqual(docProblems(fresh), []);
      assert.match(fresh.readmeText ?? '', /\*\*0 of 5 steps closed \(0%\)\.\*\* Phase 0: First\./);
      assert.match(fresh.readmeText ?? '', /Way back right now\s+\| revert/);
      const moved = { ...fresh, progress: parseProgress(progress({ 'T-0.1': 'done' })) };
      assert.ok(docProblems(moved).some((p) => p.includes('out of date')));
      const bare = '# Test migration\n';
      assert.ok(
        docProblems({
          ...fresh,
          readmeText: bare,
          docs: { ...fresh.docs, 'README.md': bare }
        }).some((p) => p.includes('no status block'))
      );
      assert.ok(
        docProblems({ ...fresh, docs: { ...fresh.docs, 'safety.md': 'TODO(the facts)' } }).some(
          (p) => p.includes('safety.md: still holds')
        )
      );
      assert.ok(
        docProblems({ ...fresh, docs: { ...fresh.docs, 'safety.md': null } }).includes(
          'safety.md: missing'
        )
      );
    });
    test('stripping the status block leaves the hand-written README', () => {
      const fresh = programmeOf(PLAN, progress());
      assert.equal(stripStatus(fresh.readmeText ?? ''), stripStatus(README));
      assert.equal(stripStatus('# no block\n'), '# no block\n');
    });
    test('the index lists every migration and never changes when a step does', () => {
      const index = renderIndex([programmeOf(PLAN, progress())]);
      assert.match(
        index,
        /\| \[p\]\(\.\/p\/README\.md\) \| Test migration \| `safe-migration health p`/
      );
      assert.equal(renderIndex([programmeOf(PLAN, progress({ 'T-0.1': 'done' }))]), index);
      assert.match(renderIndex([]), /No migrations yet\./);
    });
  });
  describe('health', () => {
    const report = (planText, progressText, legacy = false) =>
      healthReport(programmeOf(planText, progressText, legacy), { date: '2026-02-01' });
    test('a fresh migration is healthy and says what comes next and who must approve it', () => {
      const health = report(PLAN, progress({ 'T-0.1': 'done' }));
      assert.equal(health.verdict, 'HEALTHY', JSON.stringify(health.findings));
      assert.equal(health.closed, 1);
      assert.deepEqual(
        health.eligible.map((s) => [s.id, s.pattern, s.needs.length]),
        [
          ['T-0.2', 'decide', 0],
          ['T-0.3', 'observe', 1]
        ]
      );
      assert.equal(health.wayBackNow, 'nothing to undo');
      assert.equal(health.guarantees.length, 5);
      assert.deepEqual(
        health.checks.map((check) => check.active),
        [true, true, false]
      );
    });
    test('attention: a stale step, a blocker, a gate to record, an older-format plan', () => {
      const stale = report(
        PLAN,
        progress({ 'T-0.1': 'in-progress' }, 'no', { updated: '2026-01-01' })
      );
      assert.equal(stale.verdict, 'ATTENTION');
      assert.ok(stale.findings.some((f) => f.message.includes('in progress for 31 days')));
      const blocked = report(
        PLAN,
        progress({ 'T-0.1': 'blocked' }).replace('None.', '- **T-0.1**: waiting on access')
      );
      assert.ok(blocked.findings.some((f) => f.area === 'blockers'));
      const gateDue = report(PLAN, progress({ 'T-0.1': 'done', 'T-0.2': 'done', 'T-0.3': 'done' }));
      assert.ok(gateDue.findings.some((f) => f.area === 'gates'));
      const legacy = report(MEDIUM_PLAN, progress(), true);
      assert.equal(legacy.verdict, 'ATTENTION');
      assert.equal(legacy.contractGaps.length, 1);
    });
    test('unsafe: the contract is broken or the files disagree', () => {
      assert.equal(report(MEDIUM_PLAN, progress()).verdict, 'UNSAFE');
      const outOfOrder = report(PLAN, progress({ 'T-1.1': 'in-progress' }));
      assert.equal(outOfOrder.verdict, 'UNSAFE');
      assert.ok(outOfOrder.fails >= 1);
    });
    test('complete: every step closed and every gate met', () => {
      const all = {
        'T-0.1': 'done',
        'T-0.2': 'done',
        'T-0.3': 'done',
        'T-1.1': 'done',
        'T-1.2': 'done'
      };
      assert.equal(report(PLAN, progress(all, 'yes', { gate1: 'yes' })).verdict, 'COMPLETE');
    });
  });
  describe('holes a reviewer found', () => {
    const phase0 = { 'T-0.1': 'done', 'T-0.2': 'done', 'T-0.3': 'done' };
    test('a dropped step no longer satisfies "only after"', () => {
      const plan = patternPlan(['observe', 'switch']);
      assert.deepEqual(
        contractGaps(plan).filter((g) => g.includes('observe step')),
        []
      );
      const dropped = { steps: /* @__PURE__ */ new Map([['Q-0.1', { status: 'dropped' }]]) };
      assert.ok(contractGaps(plan, dropped).some((g) => g.includes('no observe step')));
    });
    test('the prod path is read from any bullet, compared as globs, and must be declared', () => {
      const prose = PLAN.replace(
        '## Prod path\n\nNone.',
        '## Prod path\n\n- `src/a.ts`: the entry'
      );
      assert.ok(
        validate(parsePlan(prose), parseProgress(progress())).some((p) =>
          p.includes('T-0.1 touches the prod path')
        )
      );
      const bare = PLAN.replace('## Prod path\n\nNone.', '## Prod path\n\n- the entry file');
      assert.ok(
        validate(parsePlan(bare), parseProgress(progress())).some((p) =>
          p.includes('has no backticked glob')
        )
      );
      const silent = PLAN.replace('## Prod path\n\nNone.', '## Prod path\n\nTo be listed.');
      assert.ok(
        validate(parsePlan(silent), parseProgress(progress())).some((p) =>
          p.includes('the prod path is undeclared')
        )
      );
      assert.ok(globsOverlap('apps/*/src/**', 'apps/backend/**'));
      assert.ok(globsOverlap('src/**', 'src/a.ts'));
      assert.ok(
        globsOverlap('.github/workflows/deploy-*.yml', '.github/workflows/deploy-db-migrate.yml')
      );
      assert.ok(!globsOverlap('apps/web/**', 'apps/backend/**'));
      assert.ok(!globsOverlap('docs/**', 'src/a.ts'));
      assert.ok(!globsOverlap('a/*.ts', 'a/b.md'));
    });
    test('a step that needs a human keeps the name of who approved it', () => {
      const plan = parsePlan(PLAN);
      const unnamed = progress({ 'T-0.1': 'done', 'T-0.3': 'in-progress' }, 'no', {
        noApprovals: true
      });
      assert.ok(
        validate(plan, parseProgress(unnamed)).some((p) =>
          p.includes(`T-0.3 needs a human's approval but "## Approvals" names no one`)
        )
      );
      const dropped = progress({ 'T-0.1': 'dropped' }, 'no', { noApprovals: true });
      assert.ok(
        validate(plan, parseProgress(dropped)).some((p) =>
          p.includes('T-0.1 is dropped with no row')
        )
      );
    });
    test('a live-write step is not done without its write-log row', () => {
      const live = parsePlan(
        PLAN.replace('| T-1.1 | d    | p     | No        ', '| T-1.1 | d | p | Yes: prod').replace(
          '| T-1.1 | PR     | move    | no ',
          '| T-1.1 | PR     | move    | yes'
        )
      );
      const done = (writeLog) =>
        validate(
          live,
          parseProgress(
            progress({ ...phase0, 'T-1.1': 'done' }, 'yes', {
              approvals: '| 2026-01-02 | T-1.1 | start | Ada |',
              writeLog
            })
          )
        );
      assert.ok(done().some((p) => p.includes('no live write log row names T-1.1')));
      assert.deepEqual(done('| 2026-01-02 | T-1.1 | prod | cmd | plan output | Ada | ok |'), []);
    });
    test('a check that needs nothing always runs, however that is spelled', () => {
      const needs = (cell) =>
        parsePlan(PLAN.replace('| Zero downtime  | nothing   |', `| Zero downtime  | ${cell} |`))
          .probes[1]?.needs;
      assert.equal(needs('none'), 'nothing');
      assert.equal(needs('nothing (repo only)'), 'nothing');
      assert.equal(needs(''), 'nothing');
      assert.equal(needs('prod read'), 'prod read');
    });
    test('a decorated or repeated step id is a problem, never a silently missing step', () => {
      const bold = PLAN.replace('| T-1.2 | e    | p ', '| **T-1.2** | e | p ');
      assert.ok(parsePlan(bold).problems.some((p) => p.includes('"**T-1.2**" is decorated')));
      const twice = progress().replace(/^(\| T-0\.1 .*)$/m, '$1\n$1');
      assert.ok(parseProgress(twice).problems.includes('progress.md: T-0.1 has two rows'));
    });
    test('a step changes only what its kind allows', () => {
      const docs = parsePlan(PLAN.replace('`./notes.md`', '`src/x.ts`  '));
      assert.ok(contractGaps(docs).some((g) => g.startsWith('T-0.2 is a Docs step')));
      const action = parsePlan(
        PLAN.replace('| nothing to undo | none         |', '| nothing to undo | `src/x.ts`   |')
      );
      assert.ok(contractGaps(action).some((g) => g.startsWith('T-0.3 is an Action step')));
    });
    test('an amendment never changes the record', () => {
      const base = progress({ 'T-0.1': 'in-progress' });
      assert.deepEqual(amendmentProblems(base, base), []);
      assert.deepEqual(
        amendmentProblems(
          base,
          progress({ 'T-0.1': 'blocked' }).replace('None.', '- **T-0.1**: amendment needed')
        ),
        []
      );
      assert.ok(
        amendmentProblems(base, progress({ 'T-0.1': 'done' })).some((p) =>
          p.includes('T-0.1 went from in-progress to done')
        )
      );
      assert.ok(
        amendmentProblems(base, base.replace('| D-1 | keep     |', '| D-1 | changed  |')).some(
          (p) => p.includes('append-only')
        )
      );
      assert.ok(
        amendmentProblems(base, progress({ 'T-0.1': 'in-progress' }, 'yes')).some((p) =>
          p.includes('gate 0 changed')
        )
      );
    });
  });
  test('progress discipline: only the step row changes, logs are append-only', () => {
    const base = progress({ 'T-0.1': 'in-progress' });
    const own = base.replace('| T-0.1 | w | in-progress |', '| T-0.1 | w | done |');
    assert.deepEqual(disciplineProblems(base, own, 'T-0.1', 0), []);
    const other = base.replace('| T-0.2 | w | todo |', '| T-0.2 | w | done |');
    assert.ok(
      disciplineProblems(base, other, 'T-0.1', 0).some((p) => p.includes('row T-0.2 changed'))
    );
    const log = base.replace('| D-1 | keep     |', '| D-1 | changed  |');
    assert.ok(disciplineProblems(base, log, 'T-0.1', 0).some((p) => p.includes('append-only')));
  });
  test('scope globs', () => {
    assert.ok(matchesAny('src/deep/a.ts', ['src/**']));
    assert.ok(matchesAny('packages/db/scripts/tool-x.ts', ['packages/db/scripts/tool-*']));
    assert.ok(!matchesAny('packages/db/scripts/sub/tool-x.ts', ['packages/db/scripts/tool-*']));
    assert.ok(!matchesAny('mise.toml', ['src/**']));
  });
  describe('cli: a new migration from the scaffold', () => {
    const dir = mkdtempSync(join(tmpdir(), 'safe-migration-init-'));
    after(() => rmSync(dir, { recursive: true, force: true }));
    spawnSync('git', ['init', '-q', '-b', 'dev'], { cwd: dir });
    const home = join(dir, '.safe-migrations/old-to-new');
    const files = ['README.md', 'plan.md', 'progress.md', 'safety.md', 'checks/remaining.mjs'];
    test('init scaffolds the fixed folder, which fails only on its placeholders', () => {
      assert.equal(run(dir, 'init', 'old-to-new').status, 1);
      assert.equal(run(dir, 'init', 'docs/old-to-new', '--title', 'x', '--prefix', 'ON').status, 1);
      const created = run(dir, 'init', 'old-to-new', '--title', 'Old to new', '--prefix', 'ON');
      assert.equal(created.status, 0, created.stderr);
      for (const file of files) assert.ok(existsSync(join(home, file)), file);
      assert.match(readFileSync(join(dir, '.safe-migrations/README.md'), 'utf8'), /old-to-new/);
      const result = run(dir, 'validate', 'old-to-new');
      assert.equal(result.status, 1);
      const problems = result.stdout.split('\n').filter((line) => line.startsWith('  - '));
      assert.ok(problems.length > 0);
      for (const problem of problems) assert.match(problem, /placeholder/);
      assert.match(run(dir, 'next', 'old-to-new').stdout, /Do now: FIX/);
      assert.equal(run(dir, 'init', 'old-to-new', '--title', 'x', '--prefix', 'ON').status, 1);
    });
    test('with every placeholder decided it meets the full contract and is healthy', () => {
      for (const file of files)
        writeFileSync(
          join(home, file),
          readFileSync(join(home, file), 'utf8').replace(/TODO\(([^)]*)\)/g, '$1')
        );
      assert.equal(run(dir, 'render').status, 0);
      const result = run(dir, 'validate', '--all');
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /meets the full safety contract/);
      const health = run(dir, 'health', 'old-to-new', '--json');
      assert.equal(health.status, 0, health.stdout + health.stderr);
      const parsed = JSON.parse(health.stdout);
      assert.deepEqual([parsed.verdict, parsed.total, parsed.next], ['HEALTHY', 15, 'ON-0.1']);
      assert.deepEqual(
        parsed.checks.map((check) => [check.id, check.result]),
        [
          ['remaining', 'pass'],
          ['availability', 'not yet'],
          ['parity', 'not yet'],
          ['rollback', 'not yet']
        ]
      );
      assert.match(run(dir, 'next', 'old-to-new').stdout, /Do now: START ON-0\.1/);
    });
  });
  describe('cli: health checks gate every step', () => {
    const { dir } = scratchRepo('safe-migration-checks-', PLAN, progress(), {
      'up.mjs': FAILING,
      'parity.mjs': FAILING
    });
    after(() => rmSync(dir, { recursive: true, force: true }));
    const setCheck = (name, text) => writeFileSync(join(dir, HOME, 'checks', name), text);
    test('health runs the active checks that need nothing and reports the rest', () => {
      const health = run(dir, 'health', 'p');
      assert.equal(health.status, 0, health.stdout + health.stderr);
      assert.match(health.stdout, /PASS {4}remaining \(Progress\): what is left \[3 left\]/);
      assert.match(health.stdout, /NOT YET up \(Zero downtime\)/);
      assert.match(run(dir, 'health', 'p', '--no-checks').stdout, /NOT RUN remaining/);
    });
    test('a step cannot close while a check it activates fails', () => {
      assert.equal(run(dir, 'start', 'p').status, 0);
      const refused = run(dir, 'update', 'p', 'T-0.1', '--status', 'done', '--evidence', 'proof');
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /T-0\.1 cannot be done: 1 health check\(s\) fail/);
      assert.match(refused.stderr, /up \(Zero downtime\): rows differ/);
      setCheck('up.mjs', PASSING);
      const done = run(dir, 'update', 'p', 'T-0.1', '--status', 'done', '--evidence', 'proof');
      assert.equal(done.status, 0, done.stderr);
    });
    test('no step starts, and next says so, while an active check fails', () => {
      setCheck('remaining.mjs', FAILING);
      const refused = run(dir, 'start', 'p', 'T-0.2');
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /T-0\.2 cannot start: 1 health check\(s\) fail/);
      assert.match(run(dir, 'next', 'p').stdout, /Do now: FIX CHECKS/);
      assert.equal(run(dir, 'check', 'p').status, 1);
      assert.match(run(dir, 'health', 'p').stdout, /Verdict: UNSAFE/);
      setCheck('remaining.mjs', PASSING);
      assert.equal(run(dir, 'check', 'p').status, 0);
    });
    test('a check that needs access runs only by name', () => {
      const idle = run(dir, 'check', 'p');
      assert.match(idle.stdout, /NOT YET parity/);
      const named = run(dir, 'check', 'p', 'parity');
      assert.equal(named.status, 1);
      assert.match(
        named.stdout,
        /FAIL {4}parity \(Zero data loss\): old equals new \[rows differ\]/
      );
    });
  });
  describe('cli: next says the one thing to do', () => {
    const { dir } = scratchRepo('safe-migration-next-', PLAN, progress());
    after(() => rmSync(dir, { recursive: true, force: true }));
    const next = () => run(dir, 'next', 'p').stdout;
    test('start, resume, ask a human, record the gate', () => {
      assert.match(next(), /Do now: START T-0\.1\n/);
      assert.match(next(), /Run: node \S+ start p T-0\.1\n/);
      run(dir, 'start', 'p');
      assert.match(next(), /Do now: RESUME T-0\.1\n/);
      run(dir, 'update', 'p', 'T-0.1', '--status', 'done', '--evidence', 'proof');
      assert.match(next(), /Do now: START T-0\.2\n/);
      assert.match(next(), /Also eligible in parallel: T-0\.3/);
      run(dir, 'start', 'p', 'T-0.2');
      run(dir, 'update', 'p', 'T-0.2', '--status', 'done', '--evidence', 'proof');
      assert.match(next(), /Do now: ASK A HUMAN T-0\.3\n/);
      assert.match(next(), /Ask: "May I start T-0\.3: c/);
      assert.match(next(), /start p T-0\.3 --approved-by "<their name>"/);
      run(dir, 'start', 'p', 'T-0.3', '--approved-by', 'Ada');
      run(dir, 'update', 'p', 'T-0.3', '--status', 'done', '--evidence', 'proof');
      assert.match(next(), /Do now: RECORD GATE\n/);
      assert.match(next(), /gate p 0 --evidence/);
      assert.equal(run(dir, 'gate', 'p', '0', '--evidence', 'link').status, 0);
      assert.match(next(), /Do now: START T-1\.1\n/);
      assert.equal(run(dir, 'validate', 'p').status, 0);
    });
    test('a blocker comes first', () => {
      run(dir, 'start', 'p');
      run(dir, 'update', 'p', 'T-1.1', '--status', 'blocked', '--blocker', 'amendment needed');
      assert.match(next(), /Do now: UNBLOCK T-1\.1\n/);
    });
  });
  describe('cli in a scratch repo', () => {
    const { dir, git } = scratchRepo('safe-migration-', PLAN, progress());
    after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, 'src'));
    git('add', '-A');
    git('commit', '-qm', 'base');
    git('branch', 'base');
    test('start refuses a step that is not next, then starts the next one', () => {
      const refused = run(dir, 'start', 'p', 'T-1.1');
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /not next/);
      const started = run(dir, 'start', 'p', '--date', '2026-01-01');
      assert.equal(started.status, 0, started.stderr);
      assert.match(started.stdout, /Pattern: expand\./);
      assert.match(started.stdout, /Way back: revert/);
      assert.match(started.stdout, /Checks that must pass to close it: up/);
      assert.match(started.stdout, /Branch: migration\/p\/t-0\.1/);
      assert.match(
        readFileSync(join(dir, HOME, 'progress.md'), 'utf8'),
        /\| T-0\.1 \| w \| in-progress \|/
      );
      assert.match(readFileSync(join(dir, HOME, 'README.md'), 'utf8'), /In progress\s+\| T-0\.1 /);
      assert.match(
        readFileSync(join(dir, HOME, 'progress.md'), 'utf8'),
        /\| Next step\s+\| T-0\.1 \(in-progress\)/
      );
    });
    test('done needs evidence', () => {
      const refused = run(dir, 'update', 'p', 'T-0.1', '--status', 'done');
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /without --evidence/);
    });
    test('a Done needs prod step cannot be done without prod evidence', () => {
      const result = run(dir, 'update', 'p', 'T-1.1', '--status', 'done', '--evidence', 'x');
      assert.equal(result.status, 1);
    });
    test('verify passes a step that stays in scope, the generated docs included', () => {
      writeFileSync(join(dir, 'src/a.ts'), 'ok\n');
      git('add', '-A');
      git('commit', '-qm', 'work');
      const result = run(dir, 'verify', 'p', 'T-0.1', '--base', 'base');
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /OK: every change is inside the plan/);
    });
    test('verify refuses files outside the scope, plan.md edits and hand edits to the README', () => {
      writeFileSync(join(dir, 'mise.toml'), 'no\n');
      writeFileSync(
        join(dir, HOME, 'plan.md'),
        `${PLAN}
`
      );
      writeFileSync(
        join(dir, HOME, 'checks/up.mjs'),
        `${PASSING}
`
      );
      writeFileSync(
        join(dir, HOME, 'README.md'),
        `${readFileSync(join(dir, HOME, 'README.md'), 'utf8')}
A new promise.
`
      );
      git('add', '-A');
      git('commit', '-qm', 'stray');
      const result = run(dir, 'verify', 'p', 'T-0.1', '--base', 'base');
      assert.equal(result.status, 1);
      assert.match(result.stdout, /mise\.toml is outside T-0\.1's scope/);
      assert.match(result.stdout, /checks\/up\.mjs is outside T-0\.1's scope/);
      assert.match(result.stdout, /plan\.md changed/);
      assert.match(result.stdout, /README\.md changed outside its generated status block/);
      assert.doesNotMatch(result.stdout, /src\/a\.ts is outside/);
    });
    test('a step marked Human needs a named approver', () => {
      run(dir, 'update', 'p', 'T-0.1', '--status', 'done', '--evidence', 'proof');
      const refused = run(dir, 'start', 'p', 'T-0.3');
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /needs a human's approval/);
      assert.equal(run(dir, 'start', 'p', 'T-0.3', '--approved-by', 'Ada').status, 0);
    });
  });
  describe('cli: a migration that breaks its contract', () => {
    const { dir } = scratchRepo('safe-migration-unsafe-', MEDIUM_PLAN, progress());
    after(() => rmSync(dir, { recursive: true, force: true }));
    test('no step starts, and health says unsafe', () => {
      const refused = run(dir, 'start', 'p');
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /does not validate/);
      assert.match(refused.stderr, /T-1\.2 is rated Medium/);
      const health = run(dir, 'health', 'p');
      assert.equal(health.status, 1);
      assert.match(health.stdout, /Verdict: UNSAFE/);
      assert.match(run(dir, 'next', 'p').stdout, /Do now: FIX\n/);
    });
    test('an older-format migration on the legacy list still runs, with the gap reported', () => {
      writeFileSync(join(dir, LEGACY_PATH), '["p"]\n');
      const validated = run(dir, 'validate', 'p');
      assert.equal(validated.status, 0, validated.stdout);
      assert.match(validated.stdout, /1 contract gap\(s\) not blocking/);
      assert.equal(run(dir, 'validate', 'p', '--strict').status, 1);
      assert.equal(run(dir, 'validate', '--all').status, 0);
      writeFileSync(join(dir, LEGACY_PATH), '["p", "gone"]\n');
      const stale = run(dir, 'validate', '--all');
      assert.equal(stale.status, 1);
      assert.match(stale.stdout, /legacy\.json: gone is not a migration; remove it/);
      writeFileSync(join(dir, LEGACY_PATH), '["p"]\n');
      assert.equal(run(dir, 'start', 'p').status, 0);
    });
  });
  describe('cli: closing a step is validated and recorded', () => {
    const { dir, git } = scratchRepo(
      'safe-migration-close-',
      PLAN,
      progress({ 'T-0.1': 'in-progress' })
    );
    after(() => rmSync(dir, { recursive: true, force: true }));
    git('add', '-A');
    git('commit', '-qm', 'base');
    const done = (step, ...extra) =>
      run(dir, 'update', 'p', step, '--status', 'done', '--evidence', 'proof', ...extra);
    test('a step cannot close into a state that does not validate', () => {
      rmSync(join(dir, HOME, 'checks/up.mjs'));
      const refused = done('T-0.1');
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /T-0\.1 cannot be done: the migration would no longer validate/);
      assert.match(refused.stderr, /health check up is active .* but has no script/);
      writeFileSync(join(dir, HOME, 'checks/up.mjs'), PASSING);
      assert.equal(done('T-0.1').status, 0);
    });
    test('the approver of a Human step stays on record after it closes', () => {
      assert.equal(run(dir, 'start', 'p', 'T-0.2').status, 0);
      assert.equal(done('T-0.2').status, 0);
      assert.equal(run(dir, 'start', 'p', 'T-0.3', '--approved-by', 'Ada').status, 0);
      assert.match(run(dir, 'next', 'p').stdout, /Its start was approved by Ada\./);
      assert.equal(done('T-0.3').status, 0);
      assert.match(
        readFileSync(join(dir, HOME, 'progress.md'), 'utf8'),
        /\| T-0\.3\s+\| start\s+\| Ada\s+\|/
      );
      assert.equal(run(dir, 'gate', 'p', '0', '--evidence', 'link').status, 0);
      assert.match(
        readFileSync(join(dir, HOME, 'progress.md'), 'utf8'),
        /\| Current phase\s+\| 1: Second/
      );
    });
    test('a check that needs access must be named in the evidence of the step it proves', () => {
      assert.equal(run(dir, 'start', 'p', 'T-1.1').status, 0);
      const refused = done('T-1.1', '--prod-evidence', 'run');
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /T-1\.1 makes parity active/);
      assert.match(refused.stderr, /check p parity/);
      const named = run(
        dir,
        'update',
        'p',
        'T-1.1',
        '--status',
        'done',
        '--evidence',
        'proof; parity: link',
        '--prod-evidence',
        'run'
      );
      assert.equal(named.status, 0, named.stderr);
    });
    test('reading a ref never runs the working tree checks', () => {
      const health = run(dir, 'health', 'p', '--ref', 'HEAD');
      assert.match(health.stdout, /NOT RUN remaining .*reading a ref/);
    });
  });
  describe('cli: a step another agent already started', () => {
    const { dir, git } = scratchRepo('safe-migration-claim-', PLAN, progress());
    const origin = mkdtempSync(join(tmpdir(), 'safe-migration-origin-'));
    after(() => {
      rmSync(dir, { recursive: true, force: true });
      rmSync(origin, { recursive: true, force: true });
    });
    git('add', '-A');
    git('commit', '-qm', 'base');
    spawnSync('git', ['init', '-q', '--bare', origin]);
    git('remote', 'add', 'origin', origin);
    git('push', '-q', 'origin', 'dev:migration/p/t-0.1');
    test('start refuses when the step branch exists on origin', () => {
      const refused = run(dir, 'start', 'p');
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /T-0\.1 was already started elsewhere/);
      git('checkout', '-q', '-b', 'migration/p/t-0.1');
      assert.equal(run(dir, 'start', 'p').status, 0);
    });
  });
  describe('dropping a step', () => {
    const dirs = [];
    const repo = (statuses, gate0) => {
      const { dir } = scratchRepo(
        'safe-migration-drop-',
        MEDIUM_PLAN,
        progress(statuses, gate0),
        {},
        true
      );
      dirs.push(dir);
      return dir;
    };
    after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
    test('refuses to drop a step that is not next', () => {
      const dir = repo({ 'T-0.1': 'in-progress' }, 'no');
      const refused = run(dir, 'update', 'p', 'T-1.1', '--status', 'dropped', '--evidence', 'D-1');
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /not next/);
    });
    test('a step marked Human needs a named approver to be dropped', () => {
      const dir = repo({ 'T-0.1': 'done' }, 'no');
      const refused = run(dir, 'update', 'p', 'T-0.3', '--status', 'dropped', '--evidence', 'D-1');
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /--approved-by/);
      const dropped = run(
        dir,
        'update',
        'p',
        'T-0.3',
        '--status',
        'dropped',
        '--evidence',
        'D-1',
        '--approved-by',
        'Ada'
      );
      assert.equal(dropped.status, 0, dropped.stderr);
    });
    test('a step rated above Low needs accepted risk to be dropped', () => {
      const dir = repo(
        { 'T-0.1': 'done', 'T-0.2': 'done', 'T-0.3': 'done', 'T-1.1': 'done' },
        'yes'
      );
      const refused = run(
        dir,
        'update',
        'p',
        'T-1.2',
        '--status',
        'dropped',
        '--evidence',
        'D-1',
        '--approved-by',
        'Ada'
      );
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /--risk-approved-by/);
    });
    test('any drop needs a named human, a met gate, and is recorded', () => {
      const dir = repo({}, 'no');
      const drop = (...extra) =>
        run(dir, 'update', 'p', 'T-0.1', '--status', 'dropped', '--evidence', 'D-1', ...extra);
      const refused = drop();
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /a named human approves it/);
      assert.equal(drop('--approved-by', 'Ada').status, 0);
      assert.match(
        readFileSync(join(dir, HOME, 'progress.md'), 'utf8'),
        /\| T-0\.1\s+\| drop\s+\| Ada\s+\|/
      );
      const reopened = run(dir, 'update', 'p', 'T-0.1', '--status', 'done', '--evidence', 'x');
      assert.equal(reopened.status, 1);
      assert.match(reopened.stderr, /a closed step is reopened or changed only by an amendment/);
      const gated = repo({ 'T-0.1': 'done', 'T-0.2': 'done', 'T-0.3': 'done' }, 'no');
      const early = run(
        gated,
        'update',
        'p',
        'T-1.1',
        '--status',
        'dropped',
        '--evidence',
        'D-1',
        '--approved-by',
        'Ada'
      );
      assert.equal(early.status, 1);
      assert.match(early.stderr, /gate 0 is not met/);
    });
  });
  describe('cli guards on update and verify', () => {
    const { dir, git } = scratchRepo(
      'safe-migration-guards-',
      PLAN,
      progress(
        {
          'T-0.1': 'in-progress',
          'T-0.2': 'done',
          'T-0.3': 'done',
          'T-1.1': 'in-progress',
          'T-1.2': 'dropped'
        },
        'yes'
      )
    );
    after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, 'other'));
    writeFileSync(join(dir, 'other/x.ts'), 'x\n');
    git('add', '-A');
    git('commit', '-qm', 'base');
    git('branch', 'base');
    test('prod evidence does not stand in for the step proof', () => {
      const refused = run(
        dir,
        'update',
        'p',
        'T-1.1',
        '--status',
        'done',
        '--prod-evidence',
        'run'
      );
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /without --evidence/);
    });
    test('update cannot move a dropped step back to in-progress', () => {
      const refused = run(dir, 'update', 'p', 'T-1.2', '--status', 'in-progress');
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /a closed step is reopened or changed only by an amendment/);
    });
    test('verify counts renamed sources and uncommitted files', () => {
      mkdirSync(join(dir, 'src'));
      git('mv', 'other/x.ts', 'src/x.ts');
      git('commit', '-qm', 'move');
      writeFileSync(join(dir, 'stray.txt'), 'no\n');
      const result = run(dir, 'verify', 'p', 'T-0.1', '--base', 'base');
      assert.equal(result.status, 1);
      assert.match(result.stdout, /other\/x\.ts is outside T-0\.1's scope/);
      assert.match(result.stdout, /stray\.txt is outside T-0\.1's scope/);
    });
    test('verify warns when a step is bigger than the small-step budget', () => {
      writeFileSync(join(dir, 'src/big.ts'), `${'line\n'.repeat(600)}`);
      git('add', '-A');
      git('commit', '-qm', 'big');
      const result = run(dir, 'verify', 'p', 'T-0.1', '--base', 'base');
      assert.match(
        result.stdout,
        /WARNING: \d+ changed lines, above the 500-line small-step budget/
      );
    });
  });
});
