# Browser Agent

Local CLI browser automation agent built against `tz_browser_agent.md`.

## M0 Usage

```bash
npm install
npm run dev
```

The command opens a headed Chrome profile through Playwright and starts a terminal REPL.

Useful flags:

```bash
npm run dev -- --profile-dir .browser-profile
npm run dev -- --reset-profile
```

Secrets belong in `.env`; committed examples belong in `.env.example`.

## Milestone Status

- M0: TypeScript skeleton, headed persistent browser session, terminal REPL.
- M1: OpenAI `LLMProvider`, `navigate` tool schema, one-step orchestrator loop.
- M2-M6: pending.
