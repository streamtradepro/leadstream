<!-- BEGIN:ai-collaboration-rules -->
# AI collaboration rules (Claude Code + OpenAI Codex)

These rules apply to every AI coding agent working in this repository — Claude Code and OpenAI Codex alike. Read them before starting any task. GitHub is the shared source of truth; the agents coordinate only through branches, commits, pull requests, and tasks assigned by the user. Never assume you can talk to the other agent directly.

## 1. Identify yourself first

Before editing anything, state: which agent you are (Claude Code or Codex), the task you were assigned, the branch you will use, the files you expect to touch, and any possible overlap with other in-progress work (open branches and pull requests).

## 2. Branch ownership

- Never do routine work directly on `main`, `master`, or whatever the repository's default branch is (`git symbolic-ref refs/remotes/origin/HEAD` tells you).
- Claude Code works on `claude/<short-task-name>`. Codex works on `codex/<short-task-name>`.
- Only one agent works on a branch at a time. Never edit a branch the other agent is actively working on.
- Do not have both agents editing the same feature or overlapping files at the same time unless the user explicitly asks for competing implementations.
- Work on another branch only when the user explicitly assigns it.

## 3. Safe Git workflow

- Start with `git status` and look at any existing changes before doing anything else.
- Never discard, reset, revert, overwrite, or stash the user's or another agent's work without explicit approval.
- `git fetch` first; when the tree is safe, start each task branch from the latest default branch.
- Check existing branches and open pull requests so you do not duplicate work already in flight.
- Fetch again immediately before pushing or opening a pull request.
- Never force-push or rewrite shared history without explicit approval.
- Never resolve a merge conflict by blindly taking one side. If a conflict touches unclear business logic or another agent's active work, stop and report it.

## 4. Scope and implementation

- Read the relevant code, docs, architecture, and tests before editing.
- Make the smallest coherent change that fulfils the assigned task.
- Preserve existing architecture, conventions, components, and working systems unless the task requires changing them.
- Do not mix unrelated refactors or formatting changes into a feature or fix.
- Flag any change to public APIs, database schemas, authentication, billing, permissions, infrastructure, or environment-variable contracts.
- Database changes need a migration plus a rollback or recovery plan.
- Add or update tests for the behavior you changed.

## 5. Testing

- Run the relevant tests while you work.
- Before handoff, run the repository's applicable tests, linting, type checking, and build.
- When browser access is available, exercise the affected user flow and check the console and network for errors.
- Report every failed or skipped check and say why.
- Never claim a task is complete when a required check failed or was not run.

## 6. Reviews and handoffs

- Recommended pattern: one agent implements, the other independently reviews and tests.
- Reviews prioritise correctness, security, data integrity, regressions, performance, accessibility, and missing tests.
- Review findings must name the affected files and locations and separate confirmed defects from suggestions.
- Do not replace the other agent's implementation because of style preference alone.
- Every handoff or pull request states: what changed and why, files changed, tests run and their results, browser flows tested, database / API / environment / security / deployment impact, known limitations, and the areas that need the closest review.

## 7. Commits and pull requests

- Keep commits focused, with clear messages (`feat:`, `fix:`, `test:`, `docs:`, `chore:` …).
- One logical task per pull request.
- Never merge a pull request unless the user explicitly asks for it.
- Never commit unrelated files, temporary files, build artifacts, editor settings, or local-only configuration.

## 8. Secrets and external APIs

- Never commit API keys, credentials, tokens, `.env` contents, customer data, or generated secrets.
- Secrets live in the approved secret manager or in git-ignored local env files; `.env.example` holds placeholders only.
- Never expose a server-side secret (ElevenLabs, Twilio, Stripe, Supabase service role, etc.) to browser or client code.
- Never print full credentials in logs, terminal output, comments, issues, commits, or pull requests.
- Mock paid or destructive external actions in tests unless the user authorises a live test.

## 9. Actions that require explicit user approval

- Merging into the default branch
- Deploying or publishing
- Running production migrations
- Changing production environment variables
- Sending real emails, texts, calls, payments, or any customer-facing API action
- Deleting data or infrastructure
- Rotating credentials
- Changing billing, authentication, roles, or permissions

## 10. First task in an unfamiliar repository

Before making broad changes, analyse: the application's purpose, major user flows, frontend and backend architecture, database and migrations, authentication and authorisation, external APIs and webhooks, background jobs, environment variables, deployment setup, test commands, coding conventions, and security-sensitive areas.

## 11. Definition of done

A task is done only when: the requested behavior is implemented; the relevant checks pass; affected browser flows were tested where applicable; no secrets or unrelated files are included; the work sits on the correct agent-owned branch; and a complete handoff (section 6) has been provided with the remaining risks disclosed.
<!-- END:ai-collaboration-rules -->
