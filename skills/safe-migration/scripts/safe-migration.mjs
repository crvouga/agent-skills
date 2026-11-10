#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  allGaps,
  amendmentProblems,
  analyse,
  appendRow,
  APPROVALS_HEADING,
  changedFiles,
  changedLines,
  CHECK_RUNNERS,
  CHECKS_DIR,
  checkStates,
  describeStep,
  disciplineProblems,
  DOCS_URL,
  docProblems,
  findProgrammes,
  git,
  GUARANTEES,
  healthReport,
  LEGACY_PATH,
  legacyMigrations,
  INDEX_PATH,
  loadProgramme,
  matchesAny,
  migrationDir,
  MIGRATIONS_DIR,
  nextLabel,
  overview,
  parseProgress,
  PATTERNS,
  readFrom,
  renderIndex,
  renderStatus,
  repoRoot,
  resolveScope,
  setBlocker,
  setCells,
  setNow,
  SMALL_STEP_LINES,
  STALE_DAYS,
  STATUSES,
  stripStatus,
  syncNow,
  today,
  validate,
  wayBackOf,
  withStatus
} from './lib.mjs';

const USAGE = `safe-migration <command> [migration name] [step] [options]

Every migration is the folder ${MIGRATIONS_DIR}/<name>/ and is named by <name>.

The loop
  next     <name>              the one thing to do now, with the exact command (the only entry point
                               an agent needs: run it, do what it says, run it again)

Plan
  init     <name>              scaffold ${MIGRATIONS_DIR}/<name>/ (--title, --prefix)
  patterns                     the guarantees and the step patterns
  validate <name> | --all      plan, progress, README and checks agree and meet the safety contract
  render   [name]              rewrite the generated README status blocks and the index

Observe
  list                         every migration, its verdict and its next step
  status   <name>              current phase, next step, way back, blockers
  health   [name]              the full report; runs the active health checks that need no access
                               (--no-checks skips them, --check <id> also runs one that needs access,
                               --prs lists open PRs, --stale-days N)
  check    <name> [id...]      run the active health checks (and the named ones); exit 1 on a failure

Run one step
  brief    <name> <step>       the step's work, proof, risk, pattern, way back, files and branch
  start    <name> [step]       refuse unless the step is next and every check passes; mark it in-progress
  update   <name> <step>       set --status, --pr, --ticket, --evidence, --blocker
  gate     <name> <phase>      mark a phase gate met (--evidence required)
  verify   <name> <step>       the branch changes only the step's files and its own progress row
  pr-body  <name> <step>       the "Migration step" section for the PR description

Options: --ref <git ref> (read from a ref, read-only commands), --json, --date YYYY-MM-DD,
  --approved-by <name> (steps marked Human), --risk-approved-by <name> (steps rated above Low, older
  format only), --prod-evidence <link> (done on steps marked Done needs prod), --base <ref> (verify,
  which also counts unstaged and untracked files; default: SAFE_MIGRATION_BASE, else the remote's
  default branch), --amendment (verify a plan
  change instead of a step), --strict (validate: hold an older-format migration to the full contract)`;

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    ref: { type: 'string' },
    json: { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    strict: { type: 'boolean', default: false },
    date: { type: 'string' },
    title: { type: 'string' },
    prefix: { type: 'string' },
    'approved-by': { type: 'string' },
    'risk-approved-by': { type: 'string' },
    status: { type: 'string' },
    pr: { type: 'string' },
    ticket: { type: 'string' },
    evidence: { type: 'string' },
    'prod-evidence': { type: 'string' },
    blocker: { type: 'string' },
    base: { type: 'string' },
    amendment: { type: 'boolean', default: false },
    'no-checks': { type: 'boolean', default: false },
    check: { type: 'string', multiple: true },
    prs: { type: 'boolean', default: false },
    'stale-days': { type: 'string' },
    help: { type: 'boolean', default: false }
  }
});

const [command, nameArg, stepArg] = positionals;
const root = repoRoot();
const date = opts.date ?? today();
const here = dirname(fileURLToPath(import.meta.url));
const scriptFile = fileURLToPath(import.meta.url);
const SM = `node ${scriptFile.startsWith(`${root}/`) ? relative(root, scriptFile) : scriptFile}`;

function baseRef() {
  if (opts.base) return opts.base;
  if (process.env.SAFE_MIGRATION_BASE) return process.env.SAFE_MIGRATION_BASE;
  try {
    return git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], root);
  } catch {
    for (const candidate of ['origin/main', 'origin/master', 'main', 'master'])
      try {
        git(['rev-parse', '--verify', '--quiet', candidate], root);
        return candidate;
      } catch {
        continue;
      }
    return 'origin/main';
  }
}

function fail(message, details = []) {
  process.stderr.write(
    `safe-migration: REFUSED: ${message}\n${details.map((d) => `  - ${d}\n`).join('')}`
  );
  process.exit(1);
}

function out(data, text) {
  process.stdout.write(opts.json ? `${JSON.stringify(data, null, 2)}\n` : `${text}\n`);
}

function load(name = nameArg) {
  if (!name) fail(`name the migration (a folder of ${MIGRATIONS_DIR}/)`);
  return loadProgramme(root, name, opts.ref);
}

function all() {
  return findProgrammes(root, opts.ref).map((dir) => loadProgramme(root, dir, opts.ref));
}

function indexProblems() {
  const current = readFrom(root, INDEX_PATH, opts.ref);
  return current === renderIndex(all())
    ? []
    : [
        `${INDEX_PATH}: ${current === null ? 'missing' : 'out of date'} (run "safe-migration render")`
      ];
}

function problemsOf(programme, strict = opts.strict) {
  const errors = [
    ...validate(programme.plan, programme.progress),
    ...docProblems(programme),
    ...indexProblems()
  ];
  const gaps = allGaps(programme).map((gap) => `contract: ${gap}`);
  return { errors, gaps, blocking: programme.legacy && !strict ? errors : [...errors, ...gaps] };
}

function stale(problem) {
  return /out of date \(run "safe-migration render/.test(problem);
}

function stepOf(programme, id) {
  const step = programme.plan.steps.find((s) => s.id === id);
  if (!step) fail(`${id} is not a step of ${programme.programme}/plan.md`);
  if (!programme.progress.steps.has(id))
    fail(`${id} has no row in ${programme.programme}/progress.md`);
  return { step, scope: programme.plan.scopes.get(id), row: programme.progress.steps.get(id) };
}

function format(paths) {
  const prettier = join(root, 'node_modules', '.bin', 'prettier');
  if (!existsSync(prettier)) return false;
  try {
    execFileSync(prettier, ['--write', '--log-level', 'silent', ...paths], {
      cwd: root,
      stdio: 'ignore',
      timeout: 60000
    });
    return true;
  } catch {
    return false;
  }
}

function writeStatus(name) {
  const programme = loadProgramme(root, name);
  if (programme.readmeText === null) return false;
  const next = withStatus(programme.readmeText, renderStatus(programme));
  if (next === null) return false;
  if (next !== programme.readmeText)
    writeFileSync(join(root, programme.programme, 'README.md'), next);
  return true;
}

function writeIndex() {
  const programmes = findProgrammes(root).map((dir) => loadProgramme(root, dir));
  mkdirSync(join(root, MIGRATIONS_DIR), { recursive: true });
  writeFileSync(join(root, INDEX_PATH), renderIndex(programmes));
}

function save(programme, lines) {
  const path = `${programme.programme}/progress.md`;
  syncNow(lines, programme.plan);
  writeFileSync(join(root, path), lines.join('\n'));
  const formatted = format([path]);
  writeStatus(programme.name);
  writeIndex();
  process.stderr.write(
    `safe-migration: updated ${path}, the README status block and ${INDEX_PATH}${formatted ? '' : ' (prettier is not installed here: format progress.md before committing)'}\n`
  );
}

function lastLine(text) {
  return (text.trim().split('\n').at(-1) ?? '').trim().slice(0, 200);
}

function runCheck(programme, check) {
  if (!check.file)
    return { ...check, result: 'fail', detail: `no script ${CHECKS_DIR}/${check.id}.mjs` };
  const runner = CHECK_RUNNERS[check.file.split('.').at(-1)];
  if (!runner) return { ...check, result: 'fail', detail: 'not a .mjs, .ts or .sh script' };
  try {
    const stdout = execFileSync(
      runner[0],
      [...runner.slice(1), `${programme.programme}/${CHECKS_DIR}/${check.file}`],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 120000,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          SAFE_MIGRATION: programme.name,
          SAFE_MIGRATION_DIR: programme.programme
        }
      }
    );
    return { ...check, result: 'pass', detail: lastLine(stdout) };
  } catch (error) {
    return {
      ...check,
      result: 'fail',
      detail: lastLine(`${error.stdout ?? ''}\n${error.stderr ?? ''}`) || `exit ${error.status}`
    };
  }
}

function runChecks(programme, { progress = programme.progress, named = [], skip = false } = {}) {
  const states = checkStates(programme, progress);
  for (const id of named)
    if (!states.some((check) => check.id === id))
      fail(`${id} is not a health check of ${programme.programme}/plan.md`);
  return states.map((check) => {
    if (opts.ref)
      return {
        ...check,
        result: 'not run',
        detail: 'reading a ref: checks run only against the working tree'
      };
    if (named.includes(check.id)) return runCheck(programme, check);
    if (!check.active)
      return { ...check, result: 'not yet', detail: `active once ${check.from} is closed` };
    if (check.needs !== 'nothing')
      return {
        ...check,
        result: 'not run',
        detail: `needs ${check.needs}: "check ${programme.name} ${check.id}" once a human agrees`
      };
    if (skip) return { ...check, result: 'not run', detail: 'skipped' };
    return runCheck(programme, check);
  });
}

function refuseOnFailedChecks(results, doing) {
  const failed = results.filter((check) => check.result === 'fail');
  if (failed.length)
    fail(
      `${doing}: ${failed.length} health check(s) fail, so the system is not in the state the plan assumes`,
      failed.map((check) => `${check.id} (${check.guarantee}): ${check.detail}`)
    );
  return results
    .filter((check) => check.result === 'not run')
    .map((check) => `${check.id} was not run (${check.detail})`);
}

function remoteClaim(programme, id) {
  const branch = `migration/${programme.name}/${id.toLowerCase()}`;
  try {
    if (git(['rev-parse', '--abbrev-ref', 'HEAD'], root) === branch) return null;
    git(['remote', 'get-url', 'origin'], root);
    const heads = execFileSync('git', ['ls-remote', '--heads', 'origin', branch], {
      cwd: root,
      encoding: 'utf8',
      timeout: 20000,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return heads.trim()
      ? `${id} was already started elsewhere: the branch ${branch} exists on origin. Check its PR and resume from that branch; never start a second copy`
      : null;
  } catch {
    return null;
  }
}

function approverOf(programme, id, action) {
  return programme.progress.approvals.findLast((row) => row.step === id && row.action === action)
    ?.by;
}

function brief(programme, id) {
  const { step, scope, row } = stepOf(programme, id);
  const phaseName = programme.plan.phases.get(step.phase) ?? '';
  const files = scope ? resolveScope(scope, programme.programme) : [];
  const wayBack = wayBackOf(programme.plan, step);
  const pattern = scope?.pattern ? PATTERNS[scope.pattern] : null;
  const branch = `migration/${programme.name}/${step.id.toLowerCase()}`;
  const checks = programme.plan.probes.filter((check) => check.from === step.id);
  return {
    data: {
      ...step,
      phaseName,
      scope: scope ?? null,
      files,
      wayBack,
      branch,
      checks: checks.map((check) => check.id),
      status: row?.status ?? 'todo'
    },
    text: [
      `${step.id}, phase ${step.phase} (${phaseName}), status ${row?.status ?? 'todo'}`,
      `Kind: ${scope?.kind ?? '?'}   Risk: ${step.risk ?? '?'}   Human approval: ${scope?.human ? 'yes' : 'no'}   Done needs prod: ${scope?.doneNeedsProd ? 'yes' : 'no'}`,
      scope?.pattern ? `Pattern: ${scope.pattern}. ${pattern?.what ?? ''}` : null,
      `Work: ${step.work}`,
      step.proof ? `Proof: ${step.proof}` : null,
      step.liveWrite ? `Live write: ${step.liveWrite}` : null,
      `Risk note: ${step.riskText}`,
      `Way back: ${wayBack || '?'}`,
      checks.length
        ? `Checks that must pass to close it: ${checks.map((check) => check.id).join(', ')}`
        : null,
      step.parallelWith.length ? `Parallel with: ${step.parallelWith.join(', ')}` : null,
      `Branch: ${branch}`,
      `Allowed files: ${[...files, `${programme.programme}/progress.md (this step's row, Now, Blockers, append-only logs)`, 'the generated README status block and index'].join(', ')}`
    ]
      .filter(Boolean)
      .join('\n')
  };
}

function stepLine(step) {
  const tags = [step.pattern, step.kind, step.risk].filter(Boolean).join(', ');
  const needs = step.needs.length ? `needs ${step.needs.join(' and ')}` : 'no approval needed';
  return `${step.id} (${tags}; ${needs}${step.doneNeedsProd ? '; done only once prod proves it' : ''})`;
}

function bar(closed, total) {
  const filled = total ? Math.round((closed / total) * 10) : 0;
  return `[${'#'.repeat(filled)}${'.'.repeat(10 - filled)}]`;
}

function baseDrift(programme) {
  if (opts.ref) return null;
  const base = baseRef();
  let there;
  try {
    there = loadProgramme(root, programme.name, base);
  } catch {
    return `${base}: not there (a new migration, or the ref is not fetched)`;
  }
  const local = analyse(programme.plan, programme.progress);
  const remote = analyse(there.plan, there.progress);
  const differences = programme.plan.steps
    .filter((step) => local.statusOf(step.id) !== remote.statusOf(step.id))
    .map(
      (step) => `${step.id} is ${local.statusOf(step.id)} here, ${remote.statusOf(step.id)} there`
    );
  if (there.planText !== programme.planText) differences.unshift('plan.md differs');
  return `${base}: ${differences.length ? differences.join('; ') : 'same as this checkout'}`;
}

function openPrs(programme) {
  try {
    const rows = JSON.parse(
      execFileSync(
        'gh',
        [
          'pr',
          'list',
          '--state',
          'open',
          '--limit',
          '200',
          '--json',
          'number,title,headRefName,url,isDraft'
        ],
        { cwd: root, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }
      )
    );
    return rows.filter((row) => row.headRefName.startsWith(`migration/${programme.name}/`));
  } catch (error) {
    return { error: lastLine(String(error.stderr ?? error.message)) || 'gh is not available' };
  }
}

function checkLine(check) {
  return `  ${check.result.toUpperCase().padEnd(7)} ${check.id} (${check.guarantee}): ${check.proves}${check.detail ? ` [${check.detail}]` : ''}`;
}

function healthText(report, extras) {
  const lines = [
    `${report.title} (${report.migration})`,
    `Verdict: ${report.verdict}  (${report.fails} failure(s), ${report.warns} warning(s))`,
    '',
    'Position',
    `  ${report.closed}/${report.total} steps closed (${report.percent}%)${report.phase === null ? '' : `, in phase ${report.phase}: ${report.phaseName}`}`,
    `  In progress: ${report.current.length ? report.current.map(stepLine).join('; ') : 'nothing'}`,
    `  Next: ${report.eligible.length ? report.eligible.map(stepLine).join(' or ') : report.next}`,
    ...report.upcoming.map((step, i) => `  ${i ? '     ' : 'Then:'} ${stepLine(step)}`),
    `  Way back right now: ${report.wayBackNow || 'n/a'}`,
    `  Blockers: ${report.blockers ? report.blockers.replace(/\n/g, ' ') : 'none'}`,
    '',
    'Phases',
    ...report.phases.map(
      (p) =>
        `  ${String(p.phase).padStart(2)} ${bar(p.closed, p.total)} ${`${p.closed}/${p.total}`.padEnd(7)} gate ${p.gateMet ? 'met    ' : 'not met'}  ${p.name}`
    ),
    '',
    'Guarantees (what this migration promises, and what checks it)',
    ...report.guarantees.flatMap((g) => [
      `  ${g.name}: ${g.how || 'NOT DECLARED'}`,
      `    checked by: ${g.checkedBy || 'NOT DECLARED'}`
    ]),
    '',
    `Health checks (${report.migration}/${CHECKS_DIR}/)`,
    ...(extras.checks.length ? extras.checks.map(checkLine) : ['  none declared']),
    '',
    'Safety signals',
    `  Risk ratings: ${Object.entries(report.risks)
      .map(([risk, count]) => `${count} ${risk}`)
      .join(', ')}`,
    `  Steps needing a named human: ${report.human} of ${report.total}`,
    `  Steps done only once prod proves them: ${report.prodProven}`,
    `  Steps the plan marks as live writes: ${report.liveWriteSteps}; live writes logged: ${report.liveWrites}${report.lastLiveWrite ? ` (last ${report.lastLiveWrite})` : ''}`,
    `  Contract gaps: ${report.contractGaps.length}${report.legacy ? ' (older format; not blocking)' : ''}`,
    `  Decisions: ${report.decisions}   Open questions: ${report.openQuestions}   Evidence rows: ${report.evidence}`,
    '',
    'Freshness',
    `  Last updated: ${report.lastUpdated || 'unknown'}`,
    extras.drift ? `  Compared with ${extras.drift}` : null,
    ...(extras.prs === undefined
      ? []
      : [
          '',
          'Open pull requests',
          ...(Array.isArray(extras.prs)
            ? extras.prs.length
              ? extras.prs.map(
                  (pr) =>
                    `  #${pr.number} ${pr.isDraft ? '(draft) ' : ''}${pr.headRefName}  ${pr.url}`
                )
              : ['  none']
            : [`  unavailable: ${extras.prs.error}`])
        ]),
    '',
    'Findings',
    ...(report.findings.length
      ? report.findings.map(
          (f) => `  ${f.severity.toUpperCase().padEnd(4)} ${f.area}: ${f.message}`
        )
      : ['  none'])
  ];
  return lines.filter((line) => line !== null).join('\n');
}

function fullHealth(programme) {
  const report = healthReport(programme, {
    date,
    staleDays: opts['stale-days'] ? Number(opts['stale-days']) : STALE_DAYS
  });
  for (const problem of indexProblems()) {
    report.findings.push({ severity: 'fail', area: 'docs', message: problem });
    report.fails += 1;
  }
  const checks = runChecks(programme, { named: opts.check ?? [], skip: opts['no-checks'] });
  for (const check of checks.filter((c) => c.result === 'fail')) {
    report.findings.push({
      severity: 'fail',
      area: 'health check',
      message: `${check.id} (${check.guarantee}) failed: ${check.detail}`
    });
    report.fails += 1;
  }
  if (report.fails) report.verdict = 'UNSAFE';
  const extras = {
    checks,
    drift: baseDrift(programme),
    prs: opts.prs ? openPrs(programme) : undefined
  };
  return { report: { ...report, checks, drift: extras.drift, prs: extras.prs }, extras };
}

function decide(programme) {
  const name = programme.name;
  const { blocking } = problemsOf(programme, false);
  const real = blocking.filter((problem) => !stale(problem));
  if (real.length)
    return {
      action: 'FIX',
      why: 'the migration does not validate, so nothing may run',
      details: real,
      run: [`${SM} validate ${name}`]
    };
  if (blocking.length)
    return {
      action: 'RENDER',
      why: 'the generated status is out of date',
      details: blocking,
      run: [`${SM} render ${name}`]
    };
  const failed = opts['no-checks']
    ? []
    : runChecks(programme).filter((check) => check.result === 'fail');
  if (failed.length)
    return {
      action: 'FIX CHECKS',
      why: 'a health check fails, so the system is not in the state the plan assumes: find out why before any step, and amend the plan if the plan is wrong',
      details: failed.map((check) => `${check.id} (${check.guarantee}): ${check.detail}`),
      run: [`${SM} check ${name}`]
    };
  const o = overview(programme.plan, programme.progress);
  const blocked = o.current.find((step) => step.status === 'blocked');
  if (blocked || o.blockers)
    return {
      action: 'UNBLOCK',
      step: blocked?.id ?? null,
      why: 'a blocker is recorded; resolve it, or open the amendment it asks for',
      details: [String(o.blockers ?? '').replace(/\n/g, ' ')],
      run: blocked ? [`${SM} start ${name} ${blocked.id}`] : []
    };
  const current = o.current[0];
  if (current) {
    const row = programme.progress.steps.get(current.id);
    const waiting = current.doneNeedsProd && row.pr;
    return {
      action: waiting ? 'WAIT FOR PROD' : 'RESUME',
      step: current.id,
      why: waiting
        ? 'its PR exists; it is done only once a prod run proves it'
        : "it is in progress (check its PR link first: it may be another agent's)",
      details: [
        row.pr ? `PR: ${row.pr}` : 'no PR linked yet',
        ...(current.needs.length
          ? [
              `Its start was approved by ${approverOf(programme, current.id, 'start') ?? 'no one on record'}. Each live write in it still needs its own dry run and a human's approval in this session.`
            ]
          : [])
      ],
      run: waiting
        ? [
            `${SM} update ${name} ${current.id} --status done --evidence "<proof>" --prod-evidence "<prod run link>"`
          ]
        : [`${SM} brief ${name} ${current.id}`]
    };
  }
  if (o.gateDue !== null)
    return {
      action: 'RECORD GATE',
      why: `every step of phase ${o.gateDue} is closed`,
      details: [`Gate ${o.gateDue}: ${programme.progress.gates.get(o.gateDue)?.gate ?? ''}`],
      run: [`${SM} gate ${name} ${o.gateDue} --evidence "<links proving the gate>"`]
    };
  const next = o.eligible[0];
  if (!next)
    return {
      action: o.complete ? 'NOTHING: COMPLETE' : 'NOTHING',
      why: o.complete ? 'every step is closed and every gate is met' : nextLabel(o),
      details: [],
      run: []
    };
  const parallel =
    o.eligible.length > 1
      ? [
          `Also eligible in parallel: ${o.eligible
            .slice(1)
            .map((s) => s.id)
            .join(', ')}`
        ]
      : [];
  if (next.needs.length) {
    const work = programme.plan.steps.find((step) => step.id === next.id).work;
    return {
      action: 'ASK A HUMAN',
      step: next.id,
      why: `${next.id} needs ${next.needs.join(' and ')} in this session before it starts`,
      details: [`Ask: "May I start ${next.id}: ${work}? Way back: ${next.wayBack}."`, ...parallel],
      run: [
        `${SM} start ${name} ${next.id}${next.human ? ' --approved-by "<their name>"' : ''}${next.risk !== 'Low' ? ' --risk-approved-by "<their name>"' : ''}`
      ]
    };
  }
  return {
    action: 'START',
    step: next.id,
    why: `${next.id} is next and needs no approval`,
    details: parallel,
    run: [`${SM} start ${name} ${next.id}`]
  };
}

function copyTemplates(from, to, values) {
  const written = [];
  mkdirSync(join(root, to), { recursive: true });
  for (const name of readdirSync(from).sort()) {
    const source = join(from, name);
    if (statSync(source).isDirectory()) {
      cpSync(source, join(root, to, name), { recursive: true });
      written.push(...readdirSync(source).map((file) => `${to}/${name}/${file}`));
      continue;
    }
    writeFileSync(
      join(root, to, name),
      readFileSync(source, 'utf8').replace(
        /\{\{([A-Z_]+)\}\}/g,
        (match, key) => values[key] ?? match
      )
    );
    written.push(`${to}/${name}`);
  }
  return written;
}

const commands = {
  next() {
    const programme = load();
    const decision = decide(programme);
    const text = [
      `${programme.title} (${programme.programme})`,
      `Do now: ${decision.action}${decision.step ? ` ${decision.step}` : ''}`,
      `Why: ${decision.why}`,
      ...decision.details.map((detail) => `  - ${detail}`),
      ...decision.run.map((line) => `Run: ${line}`),
      decision.step ? `\n${brief(programme, decision.step).text}` : null
    ]
      .filter((line) => line !== null)
      .join('\n');
    out({ migration: programme.name, ...decision }, text);
  },

  init() {
    if (!nameArg) fail(`name the migration: it becomes ${MIGRATIONS_DIR}/<name>/`);
    const dir = migrationDir(nameArg);
    const name = posix.basename(dir);
    if (!opts.title) fail('pass --title "<what is moving from what to what>"');
    if (!/^[A-Z][A-Z0-9]*$/.test(opts.prefix ?? ''))
      fail('pass --prefix <LETTERS>, the step id prefix (for example DB gives DB-0.1)');
    if (existsSync(join(root, dir))) fail(`${dir} already exists`);
    const written = copyTemplates(join(here, '..', 'references', 'templates'), dir, {
      TITLE: opts.title,
      PREFIX: opts.prefix,
      DATE: date,
      NAME: name,
      DIR: dir,
      SKILL: `${DOCS_URL}/SKILL.md`,
      SAFE_STEPS: `${DOCS_URL}/references/safe-steps.md`
    });
    writeStatus(name);
    writeIndex();
    out(
      { created: written },
      [
        `Created ${written.join(', ')}.`,
        'Every TODO(...) is a decision to make; validate fails until none is left.',
        `Next: write the real steps and checks, then "${SM} validate ${name}".`
      ].join('\n')
    );
  },

  patterns() {
    const rows = Object.entries(PATTERNS).map(([name, pattern]) => ({ name, ...pattern }));
    out(
      {
        guarantees: GUARANTEES.map(({ key, name, meaning }) => ({ key, name, meaning })),
        patterns: rows
      },
      [
        'Guarantees every migration keeps:',
        ...GUARANTEES.map((g) => `  ${g.name}: ${g.meaning}`),
        '',
        'Step patterns (the Pattern column of "## Step scopes"):',
        ...rows.map(
          (p) =>
            `  ${p.name.padEnd(11)} ${p.what}\n${' '.repeat(14)}kind ${p.kinds.join(' or ')}${p.human ? '; Human: yes' : ''}${p.after ? `; only after ${p.after}` : ''}`
        )
      ].join('\n')
    );
  },

  list() {
    const rows = all().map((programme) => {
      const { report } = fullHealth(programme);
      return {
        migration: programme.name,
        title: programme.title,
        verdict: report.verdict,
        closed: report.closed,
        total: report.total,
        next: report.next
      };
    });
    out(
      rows,
      rows
        .map(
          (r) =>
            `${r.migration}: ${r.title}\n  ${r.verdict}; ${r.closed}/${r.total} closed; next: ${r.next}`
        )
        .join('\n') || `No migrations in ${MIGRATIONS_DIR}/.`
    );
  },

  status() {
    const programme = load();
    const o = overview(programme.plan, programme.progress);
    out(
      { migration: programme.name, title: programme.title, ...o, next: nextLabel(o) },
      [
        `${programme.title} (${programme.programme})`,
        `Phase: ${o.phase === null ? 'complete' : `${o.phase}: ${o.phaseName}`}   Closed: ${o.closed}/${o.total}`,
        `Next: ${nextLabel(o)}`,
        `Way back right now: ${o.wayBackNow || 'n/a'}`,
        `Blockers: ${o.blockers ?? 'none'}`
      ].join('\n')
    );
  },

  health() {
    const programmes = nameArg ? [load()] : all();
    if (!programmes.length) return out([], `No migrations in ${MIGRATIONS_DIR}/.`);
    const results = programmes.map(fullHealth);
    out(
      nameArg ? results[0].report : results.map((r) => r.report),
      results.map((r) => healthText(r.report, r.extras)).join('\n\n\n')
    );
    process.exit(results.some((r) => r.report.fails) ? 1 : 0);
  },

  check() {
    const programme = load();
    const results = runChecks(programme, { named: positionals.slice(2) });
    out(results, results.map(checkLine).join('\n') || '  no health checks declared');
    process.exit(results.some((check) => check.result === 'fail') ? 1 : 0);
  },

  validate() {
    if (!opts.all && !nameArg) fail('name a migration or pass --all');
    const programmes = opts.all ? all() : [load()];
    let bad = 0;
    for (const programme of programmes) {
      const { gaps, blocking } = problemsOf(programme);
      bad += blocking.length;
      const advisory = programme.legacy && !opts.strict ? gaps : [];
      process.stdout.write(
        `${programme.name}: ${blocking.length ? `${blocking.length} problem(s)` : 'ok'}${advisory.length ? ` (${advisory.length} contract gap(s) not blocking: older format; --strict lists them)` : ''}\n`
      );
      for (const problem of blocking) process.stdout.write(`  - ${problem}\n`);
      if (!blocking.length && !programme.legacy)
        process.stdout.write('  meets the full safety contract\n');
    }
    if (opts.all)
      for (const name of legacyMigrations(root)) {
        const programme = programmes.find((candidate) => candidate.name === name);
        const problem = !programme
          ? `${LEGACY_PATH}: ${name} is not a migration; remove it`
          : !allGaps(programme).length
            ? `${LEGACY_PATH}: ${name} now meets the full safety contract; remove it (the list only shrinks)`
            : null;
        if (!problem) continue;
        bad += 1;
        process.stdout.write(`${problem}\n`);
      }
    if (!programmes.length && existsSync(join(root, MIGRATIONS_DIR))) {
      const problems = indexProblems();
      bad += problems.length;
      for (const problem of problems) process.stdout.write(`${problem}\n`);
    }
    process.exit(bad ? 1 : 0);
  },

  render() {
    if (opts.ref) fail('render writes files; do not pass --ref');
    const dirs = nameArg ? [migrationDir(nameArg)] : findProgrammes(root);
    for (const dir of dirs) {
      const programme = loadProgramme(root, dir);
      const lines = [...programme.progress.lines];
      syncNow(lines, programme.plan);
      if (lines.join('\n') !== programme.progressText) {
        writeFileSync(join(root, dir, 'progress.md'), lines.join('\n'));
        format([`${dir}/progress.md`]);
      }
      if (!writeStatus(dir))
        fail(
          `${dir}/README.md has no status block: add the two marker lines where the status should appear`,
          ['<!-- safe-migration:status:start -->', '<!-- safe-migration:status:end -->']
        );
    }
    writeIndex();
    out(
      { rendered: dirs },
      `Rendered ${[...dirs.map((dir) => `${dir}/README.md`), INDEX_PATH].join(', ')}.`
    );
  },

  brief() {
    const programme = load();
    if (!stepArg) fail('name the step');
    const b = brief(programme, stepArg);
    out(b.data, b.text);
  },

  start() {
    if (opts.ref) fail('start writes progress.md; do not pass --ref');
    const programme = load();
    const problems = problemsOf(programme, false).blocking.filter((problem) => !stale(problem));
    if (problems.length)
      fail('the migration does not validate; fix it (or amend the plan) first', problems);
    const a = analyse(programme.plan, programme.progress);
    const o = overview(programme.plan, programme.progress);
    let id = stepArg;
    if (!id) {
      if (a.current.length) fail(`finish ${a.current.map((s) => s.id).join(', ')} first`);
      if (a.eligible.length !== 1)
        fail(
          a.eligible.length
            ? `several steps are eligible; name one of ${a.eligible.map((s) => s.id).join(', ')}`
            : `no step is eligible; next is ${nextLabel(o)}`
        );
      id = a.eligible[0].id;
    }
    const { step, scope, row } = stepOf(programme, id);
    const status = a.statusOf(id);
    if (status === 'in-progress') {
      out(
        { resumed: id },
        `${id} is already in progress; resuming.\n\n${brief(programme, id).text}`
      );
      return;
    }
    if (status !== 'todo' && status !== 'blocked') fail(`${id} is ${status}`);
    if (programme.progress.blockers && !programme.progress.blockers.startsWith(`- **${id}**`))
      fail('progress.md lists blockers; resolve them first', [programme.progress.blockers]);
    const waiting = a.waitingOn(step);
    if (waiting.length)
      fail(`${id} is not next: ${waiting.join(', ')} must be done or dropped first`);
    const gates = a.unmetGates(step.phase);
    if (gates.length) fail(`${id} is in phase ${step.phase}; gate ${gates.join(', ')} is not met`);
    const others = a.current.filter((s) => s.id !== id && !a.partners.get(id)?.has(s.id));
    if (others.length) fail(`${others.map((s) => s.id).join(', ')} is still open`);
    if (scope?.human && !opts['approved-by'])
      fail(
        `${id} needs a human's approval (plan.md marks it Human: yes); ask, then pass --approved-by "<name>"`
      );
    if (step.risk !== 'Low' && !opts['risk-approved-by'])
      fail(
        `${id} is rated ${step.risk}; split it or get a human's approval, then pass --risk-approved-by "<name>"`
      );
    const claim = status === 'todo' ? remoteClaim(programme, id) : null;
    if (claim) fail(claim);
    const notRun = refuseOnFailedChecks(runChecks(programme), `${id} cannot start`);
    const lines = [...programme.progress.lines];
    const approvers = [...new Set([opts['approved-by'], opts['risk-approved-by']].filter(Boolean))];
    setCells(lines, row, { status: 'in-progress', updated: date });
    if (approvers.length)
      appendRow(lines, APPROVALS_HEADING, [date, id, 'start', approvers.join(' and ')]);
    setNow(
      lines,
      programme.progress,
      'Last updated',
      `${date}, ${id} started${approvers.length ? ` (approved by ${approvers.join(' and ')})` : ''}`
    );
    if (status === 'blocked') setBlocker(lines, id, null);
    save(programme, lines);
    out(
      { started: id, checksNotRun: notRun },
      [`Started ${id}.`, ...notRun.map((line) => `Note: ${line}`), '', brief(load(), id).text].join(
        '\n'
      )
    );
  },

  update() {
    if (opts.ref) fail('update writes progress.md; do not pass --ref');
    const programme = load();
    if (!stepArg) fail('name the step');
    const { step, row } = stepOf(programme, stepArg);
    const a = analyse(programme.plan, programme.progress);
    const scope = programme.plan.scopes.get(stepArg);
    const updates = { updated: date };
    const closing = ['done', 'dropped'].includes(opts.status) && opts.status !== row.status;
    if (opts.status) {
      if (!STATUSES.includes(opts.status)) fail(`status must be one of ${STATUSES.join(', ')}`);
      if (['done', 'dropped'].includes(row.status) && opts.status !== row.status)
        fail(
          `${stepArg} is ${row.status}; a closed step is reopened or changed only by an amendment a human approves`
        );
      if (opts.status === 'in-progress' && row.status !== 'in-progress')
        fail(`use "start" to begin or resume ${stepArg}`);
      if (opts.status === 'todo' && row.status !== 'todo')
        fail(`${stepArg} was started; block it or finish it, it does not go back to todo`);
      if (['done', 'blocked'].includes(opts.status) && a.statusOf(stepArg) === 'todo')
        fail(`${stepArg} was never started`);
      if (opts.status === 'blocked' && !opts.blocker)
        fail('a blocked step needs --blocker "<what unblocks it>"');
      if (opts.status === 'dropped' && !opts.evidence)
        fail('a dropped step needs --evidence naming its decision-log entry');
      if (opts.status === 'dropped' && row.status !== 'dropped') {
        const waiting = a.waitingOn(step);
        if (waiting.length)
          fail(`${stepArg} is not next: ${waiting.join(', ')} must be done or dropped first`);
        const gates = a.unmetGates(step.phase);
        if (gates.length)
          fail(`${stepArg} is in phase ${step.phase}; gate ${gates.join(', ')} is not met`);
        if (!opts['approved-by'])
          fail(
            `dropping a step removes a safeguard from the plan, so a named human approves it: ask, then pass --approved-by "<name>"`
          );
        if (step.risk !== 'Low' && !opts['risk-approved-by'])
          fail(
            `${stepArg} is rated ${step.risk}; dropping it needs a human's approval: pass --risk-approved-by "<name>"`
          );
      }
      updates.status = opts.status;
    }
    if (opts.pr) updates.pr = opts.pr;
    if (opts.ticket) updates.ticket = opts.ticket;
    if (opts.evidence) updates.evidence = opts.evidence;
    const stepEvidence = opts.evidence ?? row.evidence;
    if ((opts.status ?? row.status) === 'done' && !stepEvidence)
      fail(`${stepArg} cannot be done without --evidence`);
    if (opts.status === 'done' && scope?.doneNeedsProd) {
      if (!opts['prod-evidence'])
        fail(
          `${stepArg} is marked Done needs prod: pass --prod-evidence "<link to the prod run that proves it>"`
        );
      updates.evidence = `${stepEvidence}; prod: ${opts['prod-evidence']}`;
    }
    if (opts.status === 'done' && closing) {
      const unproven = programme.plan.probes.filter(
        (check) =>
          check.from === stepArg &&
          check.needs !== 'nothing' &&
          !new RegExp(`\\b${check.id}\\b`).test(stepEvidence)
      );
      if (unproven.length)
        fail(
          `${stepArg} makes ${unproven.map((check) => check.id).join(', ')} active, and the script cannot run a check that needs access`,
          unproven.map(
            (check) =>
              `run "check ${programme.name} ${check.id}" once a human agrees (needs ${check.needs}), then name it in --evidence: "${check.id}: <link to its output>"`
          )
        );
    }
    const lines = [...programme.progress.lines];
    setCells(lines, row, updates);
    if (opts.status === 'dropped' && closing)
      appendRow(lines, APPROVALS_HEADING, [date, stepArg, 'drop', opts['approved-by']]);
    const after = parseProgress(lines.join('\n'));
    if (closing) {
      const broken = problemsOf({ ...programme, progress: after }, false).blocking.filter(
        (problem) => !stale(problem)
      );
      if (broken.length)
        fail(`${stepArg} cannot be ${opts.status}: the migration would no longer validate`, broken);
    }
    const notRun =
      opts.status === 'done' && closing
        ? refuseOnFailedChecks(
            runChecks(programme, { progress: after }),
            `${stepArg} cannot be done`
          )
        : [];
    setNow(
      lines,
      programme.progress,
      'Last updated',
      `${date}, ${stepArg} ${opts.status ?? 'updated'}`
    );
    if (opts.status === 'blocked') setBlocker(lines, stepArg, opts.blocker);
    else if (opts.status && row.status === 'blocked') setBlocker(lines, stepArg, null);
    save(programme, lines);
    const due = analyse(programme.plan, after).gateDue;
    out(
      { updated: stepArg, gateDue: due ?? null, checksNotRun: notRun },
      [
        `Updated ${stepArg}.`,
        ...notRun.map((line) => `Note: ${line}`),
        due !== undefined && due === step.phase
          ? `Every step of phase ${due} is closed: record gate ${due} with "gate" once its condition is proven.`
          : null
      ]
        .filter((line) => line !== null)
        .join('\n')
    );
  },

  gate() {
    if (opts.ref) fail('gate writes progress.md; do not pass --ref');
    const programme = load();
    const phase = Number(stepArg);
    if (stepArg === undefined || Number.isNaN(phase)) fail('name the phase number');
    if (!opts.evidence) fail('a gate needs --evidence proving its condition');
    const problems = problemsOf(programme, false).blocking.filter((problem) => !stale(problem));
    if (problems.length)
      fail('the migration does not validate; fix it (or amend the plan) first', problems);
    const a = analyse(programme.plan, programme.progress);
    const open = programme.plan.steps.filter((s) => s.phase === phase && !a.closed(s.id));
    if (open.length)
      fail(`phase ${phase} still has open steps: ${open.map((s) => s.id).join(', ')}`);
    const earlier = a.unmetGates(phase);
    if (earlier.length) fail(`gate ${earlier.join(', ')} comes first and is not met`);
    const gate = programme.progress.gates.get(phase);
    if (!gate) fail(`progress.md has no gate row for phase ${phase}`);
    const notRun = refuseOnFailedChecks(runChecks(programme), `gate ${phase} cannot be recorded`);
    const lines = [...programme.progress.lines];
    setCells(lines, gate, { met: 'yes', evidence: opts.evidence });
    setNow(lines, programme.progress, 'Last updated', `${date}, gate ${phase} met`);
    save(programme, lines);
    const next = nextLabel(overview(programme.plan, parseProgress(lines.join('\n'))));
    out(
      { gate: phase, checksNotRun: notRun },
      [`Gate ${phase} recorded. Next: ${next}`, ...notRun.map((line) => `Note: ${line}`)].join('\n')
    );
  },

  verify() {
    const programme = load();
    const base = baseRef();
    const { files, mergeBase } = changedFiles(root, base);
    const progressPath = `${programme.programme}/progress.md`;
    const planPath = `${programme.programme}/plan.md`;
    const readmePath = `${programme.programme}/README.md`;
    const baseProgress = readFrom(root, progressPath, mergeBase);
    const currentProgress = readFileSync(join(root, progressPath), 'utf8');
    const problems = [];
    const warnings = [];
    if (opts.amendment) {
      const allowed = [`${programme.programme}/**`, INDEX_PATH, 'docs/adr/**'];
      for (const file of files)
        if (!matchesAny(file, allowed))
          problems.push(`${file} is not a migration doc; an amendment changes docs only`);
      if (!files.includes(planPath))
        problems.push(`an amendment changes ${planPath}; it is unchanged`);
      problems.push(...amendmentProblems(baseProgress, currentProgress));
      for (const file of files.filter((f) => f.startsWith(`${programme.programme}/${CHECKS_DIR}/`)))
        warnings.push(
          `${file} changed: a human reviews every change to a health check, since it decides what "healthy" means`
        );
    } else {
      if (!stepArg) fail('name the step (or pass --amendment)');
      const { step, scope } = stepOf(programme, stepArg);
      const scoped = scope ? resolveScope(scope, programme.programme) : [];
      for (const file of files) {
        if (matchesAny(file, programme.plan.prodPath) && !(scope?.human && scope?.doneNeedsProd))
          problems.push(
            `${file} is on the prod path, but ${stepArg} is not marked Human and Done needs prod`
          );
        if (file === planPath)
          problems.push(
            `${planPath} changed: plan changes go in a separate amendment PR (verify --amendment)`
          );
        else if (file === progressPath || file === INDEX_PATH || matchesAny(file, scoped)) continue;
        else if (file === readmePath) {
          const base = readFrom(root, readmePath, mergeBase);
          if (base !== null && stripStatus(base) !== stripStatus(programme.readmeText ?? ''))
            problems.push(
              `${readmePath} changed outside its generated status block, which is outside ${stepArg}'s scope`
            );
        } else problems.push(`${file} is outside ${stepArg}'s scope`);
      }
      problems.push(...disciplineProblems(baseProgress, currentProgress, stepArg, step.phase));
      const status = programme.progress.steps.get(stepArg)?.status;
      if (!['in-progress', 'done', 'blocked'].includes(status))
        problems.push(`${stepArg} is ${status} in progress.md; run "start" first`);
      const size = changedLines(root, mergeBase, [
        `${MIGRATIONS_DIR}/**`,
        '**/pnpm-lock.yaml',
        'pnpm-lock.yaml',
        '**/package-lock.json',
        'package-lock.json',
        '**/yarn.lock',
        'yarn.lock',
        '**/*.lock',
        '*.lock',
        '**/*.snap'
      ]);
      if (size > SMALL_STEP_LINES)
        warnings.push(
          `${size} changed lines, above the ${SMALL_STEP_LINES}-line small-step budget: if this is not generated or mechanical, block the step and amend the plan to split it`
        );
    }
    problems.push(...problemsOf(programme, false).blocking.map((p) => `validate: ${p}`));
    problems.push(
      ...runChecks(programme)
        .filter((check) => check.result === 'fail')
        .map((check) => `health check ${check.id} (${check.guarantee}) fails: ${check.detail}`)
    );
    out(
      { ok: problems.length === 0, base, mergeBase, files, problems, warnings },
      [
        `Changed files against ${base} (${mergeBase.slice(0, 12)}):`,
        ...files.map((f) => `  ${f}`),
        ...warnings.map((w) => `WARNING: ${w}`),
        problems.length
          ? `REFUSED, ${problems.length} problem(s):`
          : 'OK: every change is inside the plan and every active check passes.',
        ...problems.map((p) => `  - ${p}`)
      ].join('\n')
    );
    process.exit(problems.length ? 1 : 0);
  },

  'pr-body'() {
    const programme = load();
    if (!stepArg) fail('name the step');
    const { data } = brief(programme, stepArg);
    const described = describeStep(programme.plan, data, data.status);
    const files = [...data.files, `${programme.programme}/progress.md`];
    out(
      data,
      [
        '## Migration step',
        '',
        `[${programme.title}](${programme.programme}/README.md): **${data.id}**, phase ${data.phase} (${data.phaseName}). ${described.pattern ? `Pattern ${described.pattern}, kind` : 'Kind'} ${data.scope?.kind ?? '?'}, risk **${data.risk ?? '?'}**.`,
        '',
        `- **Work:** ${data.work}`,
        data.proof ? `- **Proof:** ${data.proof}` : null,
        `- **Risk note:** ${data.riskText}`,
        `- **Way back:** ${data.wayBack || '?'}`,
        data.liveWrite ? `- **Live write:** ${data.liveWrite}` : null,
        data.checks.length ? `- **Checks that gate it:** ${data.checks.join(', ')}` : null,
        data.scope?.doneNeedsProd
          ? '- **Done needs prod:** the step is marked done in a follow-up PR once a prod run proves it.'
          : null,
        `- **Allowed files:** ${files.map((f) => `\`${f}\``).join(', ')}`,
        '',
        `Scope check: \`safe-migration verify ${programme.name} ${data.id}\` passes. Nothing outside the step is in this PR.`
      ]
        .filter((line) => line !== null)
        .join('\n')
    );
  }
};

if (opts.help || !command || !commands[command]) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(command && !opts.help ? 1 : 0);
}

try {
  commands[command]();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
