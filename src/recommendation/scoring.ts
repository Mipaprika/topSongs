export interface CandidateScoreInput {
  shortTermSimilarity: number;
  longTermSimilarity: number;
  freshness: number;
  diversity: number;
}

export function scoreCandidate(input: CandidateScoreInput): number {
  return (
    0.55 * input.shortTermSimilarity +
    0.3 * input.longTermSimilarity +
    0.1 * input.freshness +
    0.05 * input.diversity
  );
}
