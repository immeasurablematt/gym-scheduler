import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { hasClerkServerKeys } from "@/lib/auth";
import { getGoogleCalendarConnectionStatus } from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  if (hasClerkServerKeys) {
    const { userId } = await auth();

    if (!userId) {
      redirect("/sign-in");
    }
  }

  const googleCalendarStatus = await getGoogleCalendarConnectionStatus();

  return (
    <div className="space-y-6">
      {!hasClerkServerKeys && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Clerk keys are not configured locally, so this page is running in
          preview mode without authentication.
        </div>
      )}

      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">
          Dashboard
        </p>
        <h1 className="mt-2 text-3xl font-bold text-slate-900">
          Trainer integrations
        </h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Manage the trainer connection that powers calendar sync and related
          scheduling tools.
        </p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold text-slate-900">
                Google Calendar
              </h2>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] ${
                  googleCalendarStatus.state === "connected"
                    ? "bg-emerald-100 text-emerald-700"
                    : googleCalendarStatus.state === "needs_connection"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-slate-100 text-slate-600"
                }`}
              >
                {googleCalendarStatus.label}
              </span>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-slate-600">
              {googleCalendarStatus.description}
            </p>
          </div>

          <Link
            href="/api/google/calendar/connect"
            className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            {googleCalendarStatus.state === "connected"
              ? "Reconnect Google Calendar"
              : "Connect Google Calendar"}
          </Link>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <DetailPill label="Connection status" value={googleCalendarStatus.label} />
          <DetailPill
            label="Account"
            value={googleCalendarStatus.accountLabel}
          />
          <DetailPill
            label="Primary calendar"
            value={googleCalendarStatus.calendarLabel}
          />
          <DetailPill
            label="Last successful sync"
            value={googleCalendarStatus.lastSyncLabel}
          />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6">
          <h3 className="text-base font-semibold text-slate-900">
            What this controls
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            The Google Calendar connection is used to keep trainer scheduling
            aligned with calendar events.
          </p>
        </div>

        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6">
          <h3 className="text-base font-semibold text-slate-900">
            Next step
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Use the connect button above to start or refresh the OAuth flow at
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
              /api/google/calendar/connect
            </code>
            .
          </p>
        </div>
      </section>
    </div>
  );
}

function DetailPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium text-slate-900">{value}</p>
    </div>
  );
}
