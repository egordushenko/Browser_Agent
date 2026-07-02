# Browser Agent Local Instructions

- Source of truth for product and implementation requirements: `tz_browser_agent.md`.
- Follow milestones M0-M6 from section 13.
- MVP acceptance criteria are in section 10.
- Anti-requirements from section 12 are hard constraints:
  - no hardcoded selectors;
  - no scripted task-specific action sequences;
  - no hardcoded hints about site links, page texts, or business flows;
  - no full web pages in the model context.
- Secrets must live only in `.env`; never commit real keys, cookies, or session data.
- Use `.env.example` for documented variable names.
- Commit after each working milestone.
