import { NextResponse } from "next/server";

import {
  processPendingCalendarSyncJobs,
} from "@/lib/google/calendar-sync";
import { getCalendarSyncCronSecret } from "@/lib/google/config";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = getCalendarSyncCronSecret();

  if (!secret) {
    return NextResponse.json(
      {
        error: "Missing CALENDAR_SYNC_CRON_SECRET.",
      },
      { status: 503 },
    );
  }

  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;

  if (token !== secret) {
    return NextResponse.json(
      {
        error: "Unauthorized.",
      },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get("limit"));
  const limit =
    Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 25)
      : 10;
  const processed = await processPendingCalendarSyncJobs(limit);

  return NextResponse.json({
    processed,
  });
}
