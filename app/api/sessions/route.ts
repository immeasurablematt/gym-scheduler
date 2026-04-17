import { after, NextResponse } from "next/server";
import { ZodError } from "zod";

import { syncSessionToCalendar } from "@/lib/google/calendar-sync";
import { SessionCreateError, createTrainerSession } from "@/lib/sessions";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const session = await createTrainerSession(body);

    after(async () => {
      try {
        await syncSessionToCalendar(session.id);
      } catch (error) {
        console.error("[calendar-sync] failed to sync newly-created session", error);
      }
    });

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Invalid session creation payload.",
          issues: error.flatten(),
        },
        { status: 400 },
      );
    }

    if (error instanceof SessionCreateError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message =
      error instanceof Error ? error.message : "Unexpected error creating session.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
