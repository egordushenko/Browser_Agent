import type { PerceptionCandidate } from "../types.js";

export interface CandidateRecord extends PerceptionCandidate {
  nearestStableContainer?: string | null;
  pageFingerprint: string;
  selector: string;
  selectorSource: "id" | "data-testid" | "name" | "aria-label" | "css-path" | "role" | "text";
}

export class CandidateRegistry {
  static empty(): CandidateRegistry {
    return new CandidateRegistry("", []);
  }

  constructor(
    readonly pageFingerprint: string,
    private readonly records: CandidateRecord[],
  ) {}

  get(candidateId: string): CandidateRecord {
    const record = this.records.find((candidate) => candidate.candidateId === candidateId);
    if (!record) {
      throw new Error(`Unknown candidateId "${candidateId}". Re-run query_dom for the current page.`);
    }
    return record;
  }

  hasHref(url: string): boolean {
    return this.records.some((candidate) => candidate.href === url);
  }
}

export function toPublicCandidate(record: CandidateRecord): PerceptionCandidate {
  const {
    nearestStableContainer: _nearestStableContainer,
    pageFingerprint: _pageFingerprint,
    selector: _selector,
    selectorSource: _selectorSource,
    ...candidate
  } = record;
  return candidate;
}
