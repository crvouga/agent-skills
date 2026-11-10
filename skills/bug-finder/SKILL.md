---
name: bug-finder
description: Hunt for bugs and security issues in the web app in this repository by running it locally, exploring it in a headless browser, and filing GitHub issues with screenshots, video, a reproduction script, and fix instructions. Use for bug hunts, QA sweeps, exploratory testing, or security testing of this app, including unattended runs in GitHub Actions. Finds and reports only; never fixes. Inspecting or editing this skill does not start a run.
allowed-tools: Bash Read Write Edit Glob Grep
---

# Bug Finder

Find real, reproducible bugs and security issues in the app in this repository, prove each one with recorded evidence, and file one GitHub issue per bug that another agent could pick up and fix without asking a single question.

The job is finding and documenting. Do not fix anything and do not change application code. A fix made mid-hunt hides the evidence and mixes two jobs that are reviewed differently.

A run is worth what a maintainer does with its issues. One proven bug with a root cause beats ten vague suspicions, and a false report costs more trust than a missed bug.

Arguments passed after `/bug-finder` narrow the run: a focus area (for example "checkout flow" or "security only") and an issue cap (for example "max 5"). With no arguments, cover the whole app and file at most 10 issues, highest severity first.

## Running it on a schedule

To run unattended in GitHub Actions, copy this skill folder to `.claude/skills/bug-finder/` in the app's repository and copy [assets/github-workflow.yml](assets/github-workflow.yml) to `.github/workflows/bug-finder.yml` there. The workflow invokes `/bug-finder` weekly and on demand, and uploads the evidence directory as a run artifact. It needs an `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` repository secret.

## Ground rules

- **Local only.** Test only the instance you started on localhost. Never point probes at production, staging, or any third-party service, even if the app's config contains those URLs. Security testing against systems you were not asked to test is an attack, not QA.
- **Check what the app talks to before starting it.** Read the env files. If the app would connect to a remote database, send real email or SMS, charge cards, or call paid APIs with live keys, swap in local or test substitutes (a local database in Docker, sandbox keys, a mail catcher, stubbed responses). If you can't, stop and report what blocks a safe run.
- **Leave the checkout as you found it.** Scratch scripts and evidence go in a work directory outside the repo: `$RUNNER_TEMP/bug-finder` when that variable is set (GitHub Actions), otherwise a fresh temp directory. Stop every server and container you started.
- **Runs are usually unattended.** Nobody can answer questions. Take the safest reasonable reading, note the choice in the final summary, and carry on. The one thing that always stops the run is anything that would touch a non-local system.

## Workflow

### 1. Understand the app

Read before running: README, CLAUDE.md or AGENTS.md, package manifests, Makefile, docker-compose files, env examples, CI workflows (they usually show the exact commands that get the app running), route definitions, and the data model. Come out with:

- How to install, seed, and start it, and which ports it uses
- The routes, pages, and API endpoints
- The user roles and what each is supposed to be able to do
- The flows that matter most (sign up, log in, the core create/edit/delete loop, payments, sharing, admin)

Bugs live where the code's intent and its behavior disagree, and you can't see that without knowing the intent.

Then read what earlier runs found: `gh issue list --label bug-finder --state all --limit 200`. Use it to avoid duplicates and to spend this run on areas that haven't been covered.

### 2. Start it

Install dependencies, bring up a local database and other backing services (Docker is available on GitHub runners), run migrations and seeds, start the app in the background with logs written to a file in the work directory, and wait until it answers on its port. Record the commit SHA under test.

Create test accounts: at least two ordinary users (A and B) and, where roles exist, one of each role. Two users are what make access-control testing possible.

If the app won't start after a reasonable effort, that is itself the finding. File a single issue titled "bug-finder: app does not start from a clean checkout" with the commands tried and the logs (or comment on that issue if it is already open), then stop. Hunting against a half-working app produces noise.

### 3. Set up the browser and recording

Use Playwright with headless Chromium, installed in the work directory if the repo doesn't already have it (`npx playwright install --with-deps chromium`). It records proof as a side effect:

- Create contexts with `recordVideo` so every session is filmed
- Take screenshots at each step that matters
- Capture console errors, page errors, failed requests, and every response with status 400 or above
- Use a normal desktop viewport, and repeat key flows at a phone viewport

Tail the server log throughout. A stack trace during a click is a lead even when the page looks fine.

### 4. Hunt

Explore like a curious, slightly hostile user, flow by flow: happy path first, then break it. Keep a notes file of leads (what you did, what looked wrong) and keep moving. Leads are verified in step 5.

**Functional bugs**

- Crashes, 500s, blank screens, uncaught console errors, endless spinners
- Forms: empty, whitespace only, very long, unicode and emoji, negative and zero and huge numbers, invalid dates, pasted HTML, double submit, submit then back then submit again
- State: data that doesn't persist after reload, stale lists after create or delete, wrong counts, broken pagination, sort and filter that disagree with the data
- Navigation: dead links, back button breaking state, deep links to pages that need earlier steps, URLs with missing or malformed IDs
- Validation that exists in the UI but not on the server (replay the request directly, without the UI)
- Error handling: what the user sees when a request fails or returns unexpected data
- Concurrency: the same record edited in two tabs, rapid repeated clicks
- Layout breakage at phone width, unreachable buttons, overflow that hides content
- Accessibility failures that block use: controls unreachable by keyboard, focus traps, unlabeled inputs

**Security issues**

- **Access control (highest yield):** as user B, request user A's resources by changing IDs in URLs and request bodies. Call admin or role-restricted endpoints as an ordinary user, and authenticated endpoints with no session at all. Check both read and write.
- **Authentication and sessions:** session still valid after logout, reset tokens reusable or guessable, no limit on login attempts, account enumeration through differing error messages, cookies missing HttpOnly, Secure, or SameSite
- **Injection:** script and event-handler payloads in every field that is later displayed (stored and reflected XSS), SQL and NoSQL metacharacters in search, filter, and sort parameters, template syntax in rendered fields, path traversal in file names and download parameters
- **Request forgery:** state-changing endpoints that accept cross-site requests without a token or SameSite protection, and server-side fetches of user-supplied URLs that can reach internal addresses
- **Data exposure:** API responses that include password hashes, tokens, other users' emails, or internal fields the UI doesn't show, secrets in the client bundle or source maps, stack traces returned to the browser
- **Mass assignment:** add fields like role, isAdmin, ownerId, or price to a create or update request and see whether they stick
- **File upload:** wrong types accepted, HTML or SVG served back from the app's origin, no size limit
- **Redirects and headers:** open redirects in next or returnTo parameters, missing security headers, permissive CORS with credentials
- **Business logic:** negative quantities, skipped steps in a multi-step flow, coupons or actions applied twice, client-supplied prices trusted

Use the source as a second lens. Read route handlers for missing auth checks, queries built by string concatenation, and unescaped output, then confirm in the running app. A code smell is only a lead. It becomes a bug when you demonstrate it.

### 5. Verify every lead

Before anything becomes an issue:

1. Reproduce it from a clean state (fresh browser context, fresh login) at least twice.
2. Reduce it to the shortest sequence of steps that still triggers it.
3. Confirm it is a defect and not intended behavior, by checking docs, tests, and code comments. If intent is unclear, say so in the issue rather than asserting.
4. Find the root cause in the code: file, function, and lines. If you can't pin it down, give your best hypothesis and label it as one.
5. Check for duplicates among open and closed issues (`gh issue list --state all --search "..."`). If it is already reported, skip it, or add a comment only when you have new evidence. If a closed issue has come back, open a new one that links the old one and says it regressed.

Drop anything that fails step 1. Flaky leads go in the summary as unconfirmed, not into issues.

### 6. Capture the proof

For each verified bug, write a small standalone Playwright script that performs the minimal reproduction from a clean state and records it. Keep the script: it goes in the issue so the fixing agent can run it before and after their change.

Produce for each bug:

- Screenshots of the key moments, each captioned with what to look at
- A video of the full reproduction, plus a short GIF version (convert with ffmpeg, installing it if missing), because GIFs play inline in an issue and video files linked from a repo do not
- The relevant console output, network request and response, and server log lines

For security issues the proof is usually the request and response pair: the request made as user B and the response containing user A's data. Use obviously fake test data in everything you capture, and redact any real secret that appears.

### 7. Publish the evidence

`gh` cannot attach files to an issue, so evidence needs a home with a URL. Push it to an orphan branch named `bugfinder-evidence`, using a separate git worktree so the checkout is untouched. Lay it out as `<date>-<short-slug>/` per bug with screenshots, GIF, video, and repro script. Set a git identity for the commit if none is configured. Reference files in the issue as `https://github.com/<owner>/<repo>/blob/bugfinder-evidence/<path>?raw=true`.

Also leave a copy of all evidence under `<work directory>/evidence/`, which the workflow uploads as a run artifact. If the push fails, say so in each issue and point to the workflow run's artifact instead of dropping the evidence.

### 8. File the issues

One issue per bug, with `gh issue create`. Create the labels `bug-finder`, `bug`, `security`, and `severity:critical|high|medium|low` if they don't exist.

**Security issues need care about visibility.** Check `gh repo view --json visibility`. On a private or internal repo, a normal issue with the `security` label is fine. On a public repo, a public issue hands a working attack to anyone watching before a fix exists, so:

- Keep the exploit details and evidence out of public issues, the evidence branch, and the artifact directory.
- If the `BUGFINDER_ADVISORY_TOKEN` environment variable is set, file a private draft security advisory with it (`GH_TOKEN=$BUGFINDER_ADVISORY_TOKEN gh api repos/{owner}/{repo}/security-advisories ...`) containing the full report.
- Otherwise open an issue that names only the affected area and severity, states that details are withheld, and asks a maintainer to re-run the bug finder locally or enable private reporting.

Use this structure for every issue:

```markdown
Title: [area] Specific observable failure (not a guess at the cause)

## Summary
Two or three sentences: what is wrong and why it matters to a user or to security.

**Severity:** critical | high | medium | low, with one line of justification
**Type:** functional | security (with the category, e.g. broken access control)
**Found at commit:** <sha>
**Environment:** OS, runtime versions, browser, viewport, how the app was started

## Steps to reproduce
Numbered, exact, starting from a clean checkout: setup commands, accounts to create,
every click and input value, every URL. No step may rely on knowledge from the hunt.

## Expected
## Actual

## Evidence
Inline GIF, screenshots with captions, link to the full video,
console and network excerpts, server log lines.

## Reproduction script
The Playwright script in a code block, with the command to run it.

## Root cause
File paths and line numbers, the faulty logic explained, and how the input
travels from the request to the failure. Mark hypotheses as hypotheses.

## How to fix
Written for an agent with no context from this run:
- The files and functions to change, and what the change should do
- A suggested approach, plus alternatives where there is a real choice
- Related places with the same pattern that should be checked or fixed together
- Pitfalls: what must not break, and behavior that looks related but is intended

## Acceptance criteria
A checklist of observable outcomes, including: the reproduction script now passes,
and a regression test (name the test file and what it should assert) is added.

## Out of scope
Anything nearby that should be left alone or handled in a separate issue.
```

Severity guide: critical means data loss, account takeover, or one user reading or changing another's data. High means a core flow is broken, or a serious security weakness that needs some precondition. Medium means a feature misbehaves but has a workaround. Low means cosmetic or minor.

Write the fix section for a reader who has never seen this app run. Anything you learned while hunting that the fixer would need (how to seed data, which account triggers it, which config flag matters) belongs in the issue.

### 9. Clean up and report

Stop servers and containers, remove the worktree, and confirm the checkout is unchanged. Then write a summary, and when `$GITHUB_STEP_SUMMARY` is set, append it to that file so it shows on the workflow run page:

- Issues filed, with links, ordered by severity
- Verified bugs not filed because of the cap
- Unconfirmed leads worth a human look
- Areas not covered and why (needed credentials, a third-party dependency, ran out of budget)
- Any judgment calls made because nobody was there to ask
