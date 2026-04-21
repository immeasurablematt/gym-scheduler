export type TrainerMatchCandidate = {
  aliases?: readonly string[] | null;
  id: string;
  name: string;
};

export type TrainerMatchResult =
  | {
      kind: "resolved";
      trainer: TrainerMatchCandidate;
    }
  | {
      kind: "ambiguous";
      matches: TrainerMatchCandidate[];
    }
  | {
      kind: "unknown";
      matches: TrainerMatchCandidate[];
    };

export function resolveTrainerName(
  candidateName: string | null | undefined,
  allowedTrainers: readonly TrainerMatchCandidate[],
): TrainerMatchResult {
  const normalizedCandidateName = normalizeTrainerName(candidateName);

  if (!normalizedCandidateName) {
    return {
      kind: "unknown",
      matches: [],
    };
  }

  const matches = allowedTrainers.filter((trainer) => {
    const candidates = [trainer.name, ...(trainer.aliases ?? [])];

    return candidates.some(
      (value) => normalizeTrainerName(value) === normalizedCandidateName,
    );
  });

  if (matches.length === 1) {
    return {
      kind: "resolved",
      trainer: matches[0],
    };
  }

  if (matches.length > 1) {
    return {
      kind: "ambiguous",
      matches,
    };
  }

  return {
    kind: "unknown",
    matches: [],
  };
}

function normalizeTrainerName(value: string | null | undefined): string {
  return (
    value
      ?.trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim() ?? ""
  );
}
