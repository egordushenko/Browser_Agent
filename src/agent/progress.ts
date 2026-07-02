export interface ProgressTrackerOptions {
  maxNoProgress: number;
}

export interface ProgressRecordInput {
  actionArgs: Record<string, unknown>;
  actionName: string;
  title: string;
  url: string;
}

export interface ProgressRecordResult {
  noProgress: boolean;
  repeatedCount: number;
}

export class ProgressTracker {
  private lastFingerprint = "";
  private repeatedCount = 0;

  constructor(private readonly options: ProgressTrackerOptions) {}

  record(input: ProgressRecordInput): ProgressRecordResult {
    const fingerprint = JSON.stringify({
      actionArgs: input.actionArgs,
      actionName: input.actionName,
      title: input.title,
      url: input.url,
    });

    if (fingerprint === this.lastFingerprint) {
      this.repeatedCount += 1;
    } else {
      this.lastFingerprint = fingerprint;
      this.repeatedCount = 1;
    }

    return {
      noProgress: this.repeatedCount >= this.options.maxNoProgress,
      repeatedCount: this.repeatedCount,
    };
  }
}
