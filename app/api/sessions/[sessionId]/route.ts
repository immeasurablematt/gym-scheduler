import { after, NextResponse } from "next/server";
import { ZodError } from "zod";

import { syncSessionToCalendar } from "@/lib/google/calendar-sync";
import { SessionUpdateError, updateTrainerSession } from "@/lib/sessions";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  try {
    const body = await request.json();
    const session = await updateTrainerSession(sessionId, body);

    after(async () => {
      try {
        await syncSessionToCalendar(session.id);
      } catch (error) {
        console.error("[calendar-sync] failed to sync updated session", error);
      }
    });

    return NextResponse.json({ session });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Invalid session update payload.",
          issues: error.flatten(),
        },
        { status: 400 },
      );
    }

    if (error instanceof SessionUpdateError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message =
      error instanceof Error ? error.message : "Unexpected error updating session.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
