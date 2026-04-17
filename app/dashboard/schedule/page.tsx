import { ScheduleEditor } from "@/components/schedule-editor";
import { getTrainerScheduleData } from "@/lib/sessions";

export default async function SchedulePage() {
  const scheduleData = await getTrainerScheduleData();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">
          Dashboard
        </p>
        <h1 className="mt-2 text-3xl font-bold text-slate-900">Schedule</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Review upcoming sessions, make quick schedule edits, and write every
          change to the session activity log.
        </p>
      </div>

      {scheduleData.isPreview ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Local preview is editing the first trainer record in Supabase because
          Clerk is disabled in this environment.
        </div>
      ) : null}

      {!scheduleData.isConfigured ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-600">
          {scheduleData.setupIssue ??
            `Add SUPABASE_SERVICE_ROLE_KEY to .env.local to enable live schedule reads and writes against ${
              process.env.NEXT_PUBLIC_SUPABASE_URL ?? "your Supabase project"
            }.`}
        </div>
      ) : !scheduleData.trainerName ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-600">
          No trainer profile is connected yet. Add a `users` row and matching
          `trainers` row in Supabase to start using the schedule flow.
        </div>
      ) : (
        <ScheduleEditor
          clientOptions={scheduleData.clientOptions}
          gymSpaceOptions={scheduleData.gymSpaceOptions}
          sessions={scheduleData.sessions}
        />
      )}
    </div>
  );
}
