export function extractAllowedNavigationUrls(task: string): string[] {
  const urls = new Set<string>();
  const consumedRanges: Array<[number, number]> = [];

  for (const match of task.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
    if (match.index === undefined) {
      continue;
    }
    const normalized = normalizeUrl(trimTrailingPunctuation(match[0]));
    if (normalized) {
      urls.add(normalized);
      consumedRanges.push([match.index, match.index + match[0].length]);
    }
  }

  for (const match of task.matchAll(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)(\/[^\s"'<>]*)?/gi)) {
    if (match.index === undefined || isInsideRange(match.index, consumedRanges)) {
      continue;
    }
    const host = match[1].toLowerCase();
    const path = trimTrailingPunctuation(match[2] ?? "/");
    const normalized = normalizeUrl(`https://${host}${path.startsWith("/") ? path : `/${path}`}`);
    if (normalized) {
      urls.add(normalized);
    }
  }

  return [...urls];
}

function normalizeUrl(value: string): string | null {
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

function trimTrailingPunctuation(value: string): string {
  return value.replace(/[),.;:!?]+$/u, "");
}

function isInsideRange(index: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}
