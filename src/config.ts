import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

export interface BrowserConfig {
  actionTimeoutMs: number;
  channel: "chrome";
  headless: false;
  navTimeoutMs: number;
  resetProfile: boolean;
  screenshotDir: string;
  userDataDir: string;
}

export interface ReplConfig {
  prompt: string;
}

export interface LlmConfig {
  apiKey?: string;
  baseUrl?: string;
  orchestratorModel: string;
  provider: "openai";
  subAgentModel: string;
}

export interface ContextConfig {
  maxDetailedSteps: number;
  maxTextChars: number;
}

export interface AgentLimitsConfig {
  maxConsecutiveErrors: number;
  maxNoProgress: number;
  maxSteps: number;
  stepTimeoutMs: number;
}

export interface AppConfig {
  browser: BrowserConfig;
  context: ContextConfig;
  limits: AgentLimitsConfig;
  llm: LlmConfig;
  repl: ReplConfig;
}

export interface ParsedCli {
  help: boolean;
  profileDir?: string;
  resetProfile: boolean;
}

export function parseCliArgs(argv: string[]): ParsedCli {
  const parsed: ParsedCli = { help: false, resetProfile: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--reset-profile") {
      parsed.resetProfile = true;
      continue;
    }
    if (arg === "--profile-dir") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--profile-dir requires a path");
      }
      parsed.profileDir = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv.slice(2),
  cwd: string = process.cwd(),
): AppConfig {
  const cli = parseCliArgs(argv);
  const profileDir = cli.profileDir ?? env.BROWSER_AGENT_PROFILE_DIR ?? ".browser-profile";
  const navTimeoutMs = Number(env.BROWSER_AGENT_NAV_TIMEOUT_MS ?? "30000");

  if (!Number.isFinite(navTimeoutMs) || navTimeoutMs <= 0) {
    throw new Error("BROWSER_AGENT_NAV_TIMEOUT_MS must be a positive number");
  }

  return {
    browser: {
      actionTimeoutMs: Number(env.BROWSER_AGENT_ACTION_TIMEOUT_MS ?? "10000"),
      channel: "chrome",
      headless: false,
      navTimeoutMs,
      resetProfile: cli.resetProfile,
      screenshotDir: path.resolve(cwd, env.BROWSER_AGENT_SCREENSHOT_DIR ?? ".screenshots"),
      userDataDir: path.resolve(cwd, profileDir),
    },
    context: {
      maxDetailedSteps: Number(env.BROWSER_AGENT_CONTEXT_RECENT_STEPS ?? "8"),
      maxTextChars: Number(env.BROWSER_AGENT_CONTEXT_MAX_TEXT_CHARS ?? "2000"),
    },
    limits: {
      maxConsecutiveErrors: Number(env.BROWSER_AGENT_MAX_CONSECUTIVE_ERRORS ?? "5"),
      maxNoProgress: Number(env.BROWSER_AGENT_MAX_NO_PROGRESS ?? "4"),
      maxSteps: Number(env.BROWSER_AGENT_MAX_STEPS ?? "40"),
      stepTimeoutMs: Number(env.BROWSER_AGENT_STEP_TIMEOUT_MS ?? "30000"),
    },
    llm: {
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.BROWSER_AGENT_API_BASE_URL,
      orchestratorModel: env.BROWSER_AGENT_ORCHESTRATOR_MODEL ?? "gpt-5.4-mini",
      provider: "openai",
      subAgentModel: env.BROWSER_AGENT_DOM_MODEL ?? "gpt-5.4-nano",
    },
    repl: {
      prompt: "browser-agent> ",
    },
  };
}

export function getUsageText(): string {
  return [
    "Browser Agent",
    "",
    "Usage:",
    "  npm run dev -- [--profile-dir <path>] [--reset-profile]",
    "",
    "Environment:",
    "  BROWSER_AGENT_PROFILE_DIR=.browser-profile",
    "  BROWSER_AGENT_SCREENSHOT_DIR=.screenshots",
    "  BROWSER_AGENT_NAV_TIMEOUT_MS=30000",
    "  BROWSER_AGENT_ACTION_TIMEOUT_MS=10000",
    "  BROWSER_AGENT_ORCHESTRATOR_MODEL=gpt-5.4-mini",
    "  BROWSER_AGENT_DOM_MODEL=gpt-5.4-nano",
    "  BROWSER_AGENT_CONTEXT_RECENT_STEPS=8",
    "  BROWSER_AGENT_CONTEXT_MAX_TEXT_CHARS=2000",
    "  BROWSER_AGENT_MAX_STEPS=40",
    "  BROWSER_AGENT_MAX_CONSECUTIVE_ERRORS=5",
    "  BROWSER_AGENT_MAX_NO_PROGRESS=4",
    "  BROWSER_AGENT_STEP_TIMEOUT_MS=30000",
    "  BROWSER_AGENT_API_BASE_URL=  # optional, e.g. https://openrouter.ai/api/v1",
    "  OPENAI_API_KEY=...",
  ].join("\n");
}
