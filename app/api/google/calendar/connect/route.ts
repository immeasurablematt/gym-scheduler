import crypto from "node:crypto";

import { NextResponse } from "next/server";

import {
  GOOGLE_CALENDAR_OAUTH_STATE_COOKIE,
  GOOGLE_CALENDAR_SCOPES,
  getGoogleCalendarConfig,
} from "@/lib/google/config";
import { requireTrainerAuthContext } from "@/lib/google/trainer-context";

export const runtime = "nodejs";

export async function GET() {
  await requireTrainerAuthContext();

  const config = getGoogleCalendarConfig();
  const state = crypto.randomUUID();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES.join(" "));
  url.searchParams.set("state", state);

  const response = NextResponse.redirect(url);
  response.cookies.set(GOOGLE_CALENDAR_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    maxAge: 10 * 60,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}
