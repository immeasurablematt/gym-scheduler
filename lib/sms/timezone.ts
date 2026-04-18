const datePartCache = new Map<string, Intl.DateTimeFormat>();
const slotLabelCache = new Map<string, Intl.DateTimeFormat>();

export type PlainDate = {
  day: number;
  month: number;
  year: number;
};

function getDatePartFormatter(timeZone: string) {
  const cacheKey = `${timeZone}:parts`;
  const cached = datePartCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  });

  datePartCache.set(cacheKey, formatter);
  return formatter;
}

function getSlotLabelFormatter(timeZone: string) {
  const cached = slotLabelCache.get(timeZone);

  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone,
    weekday: "short",
  });

  slotLabelCache.set(timeZone, formatter);
  return formatter;
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

export function getPartsInTimeZone(date: Date, timeZone: string) {
  const formatter = getDatePartFormatter(timeZone);
  const parts = formatter.formatToParts(date);
  const values: Record<string, number> = {};

  for (const part of parts) {
    if (part.type === "literal") {
      continue;
    }

    values[part.type] = Number(part.value);
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

export function getPlainDateInTimeZone(date: Date, timeZone: string): PlainDate {
  const parts = getPartsInTimeZone(date, timeZone);

  return {
    day: parts.day,
    month: parts.month,
    year: parts.year,
  };
}

export function getCurrentPlainDateInTimeZone(timeZone: string): PlainDate {
  return getPlainDateInTimeZone(new Date(), timeZone);
}

export function addDaysToPlainDate(date: PlainDate, days: number): PlainDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day));
  next.setUTCDate(next.getUTCDate() + days);

  return {
    day: next.getUTCDate(),
    month: next.getUTCMonth() + 1,
    year: next.getUTCFullYear(),
  };
}

export function getWeekdayForPlainDate(date: PlainDate) {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

export function formatSlotLabel(date: Date | string, timeZone: string) {
  const value = typeof date === "string" ? new Date(date) : date;
  return getSlotLabelFormatter(timeZone).format(value);
}

export function parseTimeString(value: string) {
  const [hourText, minuteText = "0"] = value.split(":");

  return {
    hour: Number(hourText),
    minute: Number(minuteText),
  };
}

export function minutesToTimeParts(totalMinutes: number) {
  return {
    hour: Math.floor(totalMinutes / 60),
    minute: totalMinutes % 60,
  };
}

export function timePartsToMinutes(value: string) {
  const parts = parseTimeString(value);
  return parts.hour * 60 + parts.minute;
}

export function zonedLocalDateTimeToUtc(
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
