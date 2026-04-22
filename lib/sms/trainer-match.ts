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

    return candidates.some((value) =>
      isTrainerNameMatch(normalizedCandidateName, normalizeTrainerName(value)),
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

function isTrainerNameMatch(
  normalizedCandidateName: string,
  normalizedTrainerName: string,
): boolean {
  if (!normalizedTrainerName) {
    return false;
  }

  if (normalizedTrainerName === normalizedCandidateName) {
    return true;
  }

  if (!normalizedCandidateName.includes(" ")) {
    return normalizedTrainerName.split(" ").includes(normalizedCandidateName);
  }

  return false;
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
