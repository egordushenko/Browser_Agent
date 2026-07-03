# Browser Agent

Autonomous browser agent for multi-step web tasks in a real, visible Chrome session.

The project was built for the browser-agent technical assignment in `tz_browser_agent.md`. The main goal is not to script one specific website, but to let an LLM orchestrator solve tasks through generic browser tools while the runtime keeps selectors, object state, confirmations, and safety checks under code control.

## What It Does

Browser Agent runs a terminal REPL and controls a headed persistent Chrome profile through Playwright. A user gives a natural-language task, and the agent iterates:

1. observes the current page;
2. asks a DOM sub-agent for compact page facts and clickable candidates;
3. chooses one generic tool call;
4. executes it through the runtime;
5. stores structured objects and progress state;
6. stops only after completion, a user confirmation boundary, or an honest blocker.

The implementation supports tasks such as:

- reading emails, classifying spam, and deleting confirmed spam;
- finding food items, adding them to a cart, and stopping before payment;
- studying a resume, finding relevant vacancies, preparing cover letters, and applying only after confirmation.

## Demo Scenario

The final video test uses the HH scenario from the assignment:

> Найди 3 подъодящие вакансии AI-инженера на hh.ru и откликнись на них с сопроводительным, предварительно изучив резюме в моём профиле.

Expected behavior in that scenario:

1. go to `hh.ru`;
2. study the user's profile/resume;
3. find relevant AI-engineer vacancies through search or discovered page links;
4. extract key information from each vacancy;
5. apply to suitable vacancies with a personalized cover letter;
6. require user confirmation before each application submission.

Assumption: before the task starts, the user is already logged in to `hh.ru` in the persistent Chrome profile.

Video link: to be added.

## Key Design Choices

### CandidateId Instead Of LLM Selectors

The model never receives raw Playwright selectors. Page perception creates page-scoped candidates like `c1`, `c2`, `c3`; internal selector recipes stay inside `CandidateRegistry`.

The LLM can call:

- `click({ candidateId })`
- `open_candidate({ candidateId })`
- `type({ candidateId, text })`

It cannot pass selector strings, ARIA refs, or guessed runtime locators. This removes a common failure mode where the model invents selectors such as `role=button[name="..."][ref=e123]`.

### URL Anti-Guessing

Navigation is constrained to:

- URLs/domains explicitly present in the user task;
- links actually observed in the page DOM.

Internal guessed paths such as `/account/resumes` are blocked unless they came from the task or from a real page candidate.

### Structured Object Memory

The DOM sub-agent can extract objects into memory:

- `email`
- `product`
- `vacancy`
- `resume`

Each object has a stable `objectId`, fields, candidate/action candidate links, and status:

`seen -> opened -> details_extracted -> reviewed -> selected -> action_ready -> action_done`

This lets the agent keep track of objects across navigation instead of relying on free-form chat history.

### Checkpoints

Critical task requirements are enforced by code:

- hidden details require opening the detail page first;
- objects must be reviewed before selection;
- destructive or binding actions require confirmation;
- `done` is rejected while a selected/confirmed batch is unfinished, unless the agent reports an explicit incomplete reason.

### Batch Actions

For domain-agnostic multi-object workflows, the runtime provides:

- `propose_selection({ objectType, objectIds, reason })`
- `confirm_batch({ summary })`
- `execute_batch({ action, objectIds })`

Supported batch actions include `delete`, `mark_spam`, `add_to_cart`, `apply`, `send_message`, and `stop_before_payment`.

For per-item forms, such as applying with a personalized cover letter, the agent handles each object one by one and the security gate confirms each submission individually.

### Safety Gate

Potentially irreversible actions are classified by a separate LLM call and require explicit terminal confirmation. This includes payments, purchases, deletion, sending messages, and application submissions. Ambiguous clicks fail closed.

## Architecture

```text
User task
   |
   v
Terminal REPL
   |
   v
Orchestrator LLM
   |        \
   |         \ query_dom/read_page
   |          v
   |      DOM sub-agent
   |          |
   |          v
   |      aria snapshot + public candidates + extracted objects
   |
   v
Tool runtime
   |
   +-- CandidateRegistry: candidateId -> internal Playwright locator recipe
   +-- ObjectMemory: stable objectId/status across pages
   +-- Checkpoint guards
   +-- SecurityGate
   |
   v
Playwright headed persistent Chrome
```

Important source files:

- `src/index.ts` - CLI entry point and REPL wiring.
- `src/agent/orchestrator.ts` - main agent loop.
- `src/agent/tools.ts` - tool schemas and runtime implementation.
- `src/browser/perception.ts` - compact page perception.
- `src/browser/candidate-registry.ts` - internal candidate registry.
- `src/subagents/dom-agent.ts` - DOM sub-agent protocol and parsing.
- `src/agent/object-memory.ts` - structured object memory.
- `src/agent/checkpoints.ts` - workflow checkpoint guards.
- `src/agent/security.ts` - confirmation classifier.

## Setup

Requirements:

- Node.js LTS;
- installed Google Chrome;
- OpenAI-compatible API key;
- logged-in browser profile for services that require authentication.

Install dependencies:

```bash
npm install
```

Create local environment file:

```bash
cp .env.example .env
```

Set at least:

```env
OPENAI_API_KEY=...
```

Run:

```bash
npm run dev
```

The app opens a visible Chrome window and starts:

```text
browser-agent>
```

Example:

```text
browser-agent> Найди 3 подходящие вакансии AI-инженера на hh.ru и откликнись на них с сопроводительным, предварительно изучив резюме в моём профиле
```

Useful flags:

```bash
npm run dev -- --profile-dir .browser-profile
npm run dev -- --reset-profile
npm run dev -- --help
```

By default, the browser profile is persistent. Log in manually once in the opened Chrome window; cookies and session state are reused on later runs.

## Configuration

All secrets stay in `.env`; real keys, cookies, and browser profile data must not be committed.

Main variables:

```env
BROWSER_AGENT_PROFILE_DIR=.browser-profile
BROWSER_AGENT_SCREENSHOT_DIR=.screenshots
BROWSER_AGENT_NAV_TIMEOUT_MS=30000
BROWSER_AGENT_ACTION_TIMEOUT_MS=10000
BROWSER_AGENT_ORCHESTRATOR_MODEL=gpt-5.4-mini
BROWSER_AGENT_DOM_MODEL=gpt-5.4-nano
BROWSER_AGENT_CONTEXT_RECENT_STEPS=8
BROWSER_AGENT_CONTEXT_MAX_TEXT_CHARS=2000
BROWSER_AGENT_MAX_STEPS=40
BROWSER_AGENT_MAX_CONSECUTIVE_ERRORS=5
BROWSER_AGENT_MAX_NO_PROGRESS=4
BROWSER_AGENT_STEP_TIMEOUT_MS=120000
BROWSER_AGENT_API_BASE_URL=
OPENAI_API_KEY=
```

`BROWSER_AGENT_API_BASE_URL` can point to an OpenAI-compatible endpoint. The code uses a small `LLMProvider` abstraction around the Responses API.

## Tests

```bash
npm run typecheck
npm test
```

The test suite covers:

- config parsing and REPL behavior;
- tool schemas and strict argument validation;
- candidate registry and browser smoke flows on a local HTML fixture;
- URL anti-guessing;
- DOM sub-agent JSON parsing;
- object memory;
- checkpoints;
- batch actions;
- security gate behavior;
- task-loop recovery and no-progress detection.

## Anti-Requirements

The implementation intentionally avoids:

- hardcoded site selectors;
- scripted task-specific action sequences;
- hardcoded business URLs or internal page paths;
- passing full HTML pages into the model context;
- storing secrets outside `.env`.

## Current Status

The MVP acceptance scenarios from the assignment have been implemented and tested locally. The HH application flow is the main recorded stress test; the video will be attached separately.
