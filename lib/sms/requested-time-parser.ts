export type RequestedSmsTimeParseResult =
  | { kind: "not_requested_time" }
  | { kind: "invalid_requested_time"; reason: "ambiguous_hour" | "off_interval" }
  | { kind: "requested_time"; startsAt: string };

type PlainDate = {
  day: number;
  month: number;
  year: number;
};

type ParsedTime = {
  hour: number;
  isAmbiguousHour: boolean;
  minute: number;
};

type SupportedPatternMatch =
  | {
      date: PlainDate;
      hour: number;
      isAmbiguousHour: boolean;
      minute: number;
    }
  | null;

const weekdayMap: Record<string, number> = {
  friday: 5,
  monday: 1,
  saturday: 6,
  sunday: 0,
  thursday: 4,
  tuesday: 2,
  wednesday: 3,
};

const monthMap: Record<string, number> = {
  apr: 4,
  april: 4,
  aug: 8,
  august: 8,
  dec: 12,
  december: 12,
  feb: 2,
  february: 2,
  jan: 1,
  january: 1,
  jul: 7,
  july: 7,
  jun: 6,
  june: 6,
  mar: 3,
  march: 3,
  may: 5,
  nov: 11,
  november: 11,
  oct: 10,
  october: 10,
  sep: 9,
  sept: 9,
  september: 9,
};

const monthPattern = Object.keys(monthMap)
  .sort((left, right) => right.length - left.length)
  .join("|");
const timePattern =
  "(?<hour>\\d{1,2})(?::(?<minute>\\d{2}))?\\s*(?<meridiem>am|pm)?";

export function parseRequestedSmsTime(input: {
  body: string;
  now: Date;
  slotIntervalMinutes: number;
  timeZone: string;
}): RequestedSmsTimeParseResult {
  const normalized = normalizeBody(input.body);
  const parsed = tryParseSupportedPattern(normalized, input.now, input.timeZone);

  if (!parsed) {
    return { kind: "not_requested_time" };
  }

  if (parsed.minute % input.slotIntervalMinutes !== 0) {
    return { kind: "invalid_requested_time", reason: "off_interval" };
  }

  if (parsed.isAmbiguousHour) {
    return { kind: "invalid_requested_time", reason: "ambiguous_hour" };
  }

  return {
    kind: "requested_time",
    startsAt: zonedLocalDateTimeToUtc(
      parsed.date,
      parsed.hour,
      parsed.minute,
      input.timeZone,
    ).toISOString(),
  };
}

function normalizeBody(body: string) {
  return body
    .trim()
    .toLowerCase()
    .replace(/[?!.,]+/g, " ")
    .replace(/\s+/g, " ");
}

function tryParseSupportedPattern(
  body: string,
  now: Date,
  timeZone: string,
): SupportedPatternMatch {
  return (
    tryParseRelativeDay(body, now, timeZone) ||
    tryParseExplicitMonthDay(body, now, timeZone) ||
    tryParseWeekday(body, now, timeZone)
  );
}

function tryParseRelativeDay(
  body: string,
  now: Date,
  timeZone: string,
): SupportedPatternMatch {
  const match = body.match(
    new RegExp(`\\b(?<day>today|tomorrow)\\b(?:\\s+at)?\\s+${timePattern}\\b`),
  );

  if (!match?.groups) {
    return null;
  }

  const parsedTime = toParsedTime(match.groups);

  if (!parsedTime) {
    return null;
  }

  const date = addDaysToPlainDate(
    getPlainDateInTimeZone(now, timeZone),
    match.groups.day === "tomorrow" ? 1 : 0,
  );

  return {
    date,
    ...parsedTime,
  };
}

function tryParseExplicitMonthDay(
  body: string,
  now: Date,
  timeZone: string,
): SupportedPatternMatch {
  const match = body.match(
    new RegExp(
      `\\b(?:(?<monthName>${monthPattern})\\s+(?<monthNameDay>\\d{1,2})|(?<numericMonth>\\d{1,2})/(?<numericDay>\\d{1,2}))(?:\\s+at)?\\s+${timePattern}\\b`,
    ),
  );

  if (!match?.groups) {
    return null;
  }

  const parsedTime = toParsedTime(match.groups);

  if (!parsedTime) {
    return null;
  }

  const month = match.groups.monthName
    ? monthMap[match.groups.monthName]
    : Number(match.groups.numericMonth);
  const day = match.groups.monthName
    ? Number(match.groups.monthNameDay)
    : Number(match.groups.numericDay);
  const anchorDate = getPlainDateInTimeZone(now, timeZone);
  const currentYear = anchorDate.year;

  if (!isValidPlainDate(currentYear, month, day)) {
    return null;
  }

  return {
    date: {
      day,
      month,
      year: currentYear,
    },
    ...parsedTime,
  };
}

function tryParseWeekday(
  body: string,
  now: Date,
  timeZone: string,
): SupportedPatternMatch {
  const match = body.match(
    new RegExp(
      `\\b(?<weekday>monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\b(?:\\s+at)?\\s+${timePattern}\\b`,
    ),
  );

  if (!match?.groups) {
    return null;
  }

  const parsedTime = toParsedTime(match.groups);

  if (!parsedTime) {
    return null;
  }

  const today = getPlainDateInTimeZone(now, timeZone);
  const targetWeekday = weekdayMap[match.groups.weekday];
  const todayWeekday = getWeekdayForPlainDate(today);
  let offset = (targetWeekday - todayWeekday + 7) % 7;

  if (offset === 0) {
    const localNow = getPartsInTimeZone(now, timeZone);
    const nowMinutes = localNow.hour * 60 + localNow.minute;
    const requestedMinutes = parsedTime.hour * 60 + parsedTime.minute;

    if (requestedMinutes <= nowMinutes) {
      offset = 7;
    }
  }

  return {
    date: addDaysToPlainDate(today, offset),
    ...parsedTime,
  };
}

function toParsedTime(groups: Record<string, string | undefined>): ParsedTime | null {
  const rawHour = Number(groups.hour);
  const minute = groups.minute ? Number(groups.minute) : 0;
  const meridiem = groups.meridiem?.toLowerCase();

  if (!Number.isInteger(rawHour) || rawHour < 1 || rawHour > 12) {
    return null;
  }

  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }

  if (meridiem === "am" || meridiem === "pm") {
    return {
      hour: to24Hour(rawHour, meridiem),
      isAmbiguousHour: false,
      minute,
    };
  }

  if (rawHour >= 1 && rawHour <= 7) {
    return {
      hour: rawHour === 12 ? 12 : rawHour + 12,
      isAmbiguousHour: false,
      minute,
    };
  }

  return {
    hour: rawHour,
    isAmbiguousHour: true,
    minute,
  };
}

function to24Hour(hour: number, meridiem: "am" | "pm") {
  if (meridiem === "am") {
    return hour % 12;
  }

  return hour === 12 ? 12 : hour + 12;
}

function isValidPlainDate(year: number, month: number, day: number) {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return false;
  }

  const value = new Date(Date.UTC(year, month - 1, day));
  return (
    value.getUTCFullYear() === year &&
    value.getUTCMonth() === month - 1 &&
    value.getUTCDate() === day
  );
}

function getPlainDateInTimeZone(date: Date, timeZone: string): PlainDate {
  const parts = getPartsInTimeZone(date, timeZone);

  return {
    day: parts.day,
    month: parts.month,
    year: parts.year,
  };
}

function getPartsInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const values: Record<string, number> = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = Number(part.value);
    }
  }

  return {
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    month: values.month,
    second: values.second,
    year: values.year,
  };
}

function addDaysToPlainDate(date: PlainDate, days: number): PlainDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day));
  next.setUTCDate(next.getUTCDate() + days);

  return {
    day: next.getUTCDate(),
    month: next.getUTCMonth() + 1,
    year: next.getUTCFullYear(),
  };
}

function getWeekdayForPlainDate(date: PlainDate) {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function zonedLocalDateTimeToUtc(
  date: PlainDate,
  hour: number,
  minute: number,
  timeZone: string,
) {
  const desired = getComparableUtcTimestamp(
    date.year,
    date.month,
    date.day,
    hour,
    minute,
  );
  let guess = new Date(desired);

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = getPartsInTimeZone(guess, timeZone);
    const actual = getComparableUtcTimestamp(
      parts.year,
      parts.month,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const diff = desired - actual;

    if (diff === 0) {
      break;
    }

    guess = new Date(guess.getTime() + diff);
  }

  return guess;
}

function getComparableUtcTimestamp(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
) {
  return Date.UTC(year, month - 1, day, hour, minute, second);
}
