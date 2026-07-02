import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

export interface BrowserConfig {
  channel: "chrome";
  headless: false;
  navTimeoutMs: number;
  resetProfile: boolean;
  userDataDir: string;
}

export interface ReplConfig {
  prompt: string;
}

export interface LlmConfig {
  apiKey?: string;
  orchestratorModel: string;
  provider: "openai";
}

export interface AppConfig {
  browser: BrowserConfig;
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
      channel: "chrome",
      headless: false,
      navTimeoutMs,
      resetProfile: cli.resetProfile,
      userDataDir: path.resolve(cwd, profileDir),
    },
    llm: {
      apiKey: env.OPENAI_API_KEY,
      orchestratorModel: env.BROWSER_AGENT_ORCHESTRATOR_MODEL ?? "gpt-5.4-mini",
      provider: "openai",
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
    "  BROWSER_AGENT_NAV_TIMEOUT_MS=30000",
    "  BROWSER_AGENT_ORCHESTRATOR_MODEL=gpt-5.4-mini",
    "  OPENAI_API_KEY=...",
  ].join("\n");
}
