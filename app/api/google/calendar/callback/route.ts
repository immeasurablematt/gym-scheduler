import { after, NextResponse } from "next/server";
import { cookies } from "next/headers";

import {
  exchangeGoogleCalendarCode,
  fetchPrimaryGoogleCalendarMetadataFromAccessToken,
} from "@/lib/google/client";
import { GOOGLE_CALENDAR_OAUTH_STATE_COOKIE } from "@/lib/google/config";
import { upsertTrainerCalendarConnection } from "@/lib/google/connection-service";
import {
  enqueueTrainerSessionBackfill,
  processPendingCalendarSyncJobs,
} from "@/lib/google/calendar-sync";
import { requireTrainerAuthContext } from "@/lib/google/trainer-context";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const context = await requireTrainerAuthContext();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE)?.value;

  if (error) {
    const response = NextResponse.redirect(
      new URL(
        `/dashboard/settings?googleCalendar=error&reason=${encodeURIComponent(error)}`,
        request.url,
      ),
    );
    response.cookies.delete(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE);
    return response;
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    const response = NextResponse.redirect(
      new URL("/dashboard/settings?googleCalendar=invalid_state", request.url),
    );
    response.cookies.delete(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE);
    return response;
  }

  const tokens = await exchangeGoogleCalendarCode(code);
  const metadata = await fetchPrimaryGoogleCalendarMetadataFromAccessToken(
    tokens.access_token,
  );

  await upsertTrainerCalendarConnection({
    access_token: tokens.access_token,
    calendar_time_zone: metadata.timeZone ?? null,
    google_calendar_email:
      metadata.summaryOverride ?? metadata.summary ?? metadata.id ?? null,
    google_calendar_id: metadata.id ?? "primary",
    last_sync_error: null,
    provider: "google",
    refresh_token: tokens.refresh_token ?? null,
    sync_enabled: true,
    token_expires_at: new Date(
      Date.now() + tokens.expires_in * 1000,
    ).toISOString(),
    trainer_id: context.trainer.id,
  });

  after(async () => {
    try {
      await enqueueTrainerSessionBackfill(context.trainer.id);
      await processPendingCalendarSyncJobs(10);
    } catch (backfillError) {
      console.error("[google-calendar] failed to backfill trainer sessions", backfillError);
    }
  });

  const response = NextResponse.redirect(
    new URL("/dashboard/settings?googleCalendar=connected", request.url),
  );
  response.cookies.delete(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE);
  return response;
}
