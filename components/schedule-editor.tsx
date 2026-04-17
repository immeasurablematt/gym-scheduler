"use client";

import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

import type {
  ScheduleClientOption,
  ScheduleGymSpaceOption,
  TrainerSession,
} from "@/lib/sessions";

type ScheduleEditorProps = {
  clientOptions: ScheduleClientOption[];
  gymSpaceOptions: ScheduleGymSpaceOption[];
  sessions: TrainerSession[];
};

type FormMessage = {
  kind: "error" | "success";
  text: string;
};

export function ScheduleEditor({
  clientOptions,
  gymSpaceOptions,
  sessions,
}: ScheduleEditorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [defaultCreateScheduledAt] = useState(getDefaultCreateDateTimeValue);
  const [activeAction, setActiveAction] = useState<
    | { kind: "create" }
    | { kind: "update"; sessionId: string }
    | null
  >(null);
  const [createMessage, setCreateMessage] = useState<FormMessage | null>(null);
  const [messages, setMessages] = useState<Record<string, FormMessage | undefined>>(
    {},
  );
  const createPending = isPending && activeAction?.kind === "create";

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const scheduledAt = formData.get("scheduledAt");

    if (typeof scheduledAt !== "string" || scheduledAt.length === 0) {
      setCreateMessage({
        kind: "error",
        text: "Choose a date and time before creating the session.",
      });
      return;
    }

    setActiveAction({ kind: "create" });
    setCreateMessage(null);

    startTransition(async () => {
      const response = await fetch("/api/sessions", {
        body: JSON.stringify({
          clientId: String(formData.get("clientId") ?? ""),
          durationMinutes: Number(formData.get("durationMinutes")),
          gymSpaceId: normalizeText(formData.get("gymSpaceId")),
          notes: normalizeText(formData.get("notes")),
          scheduledAt: new Date(scheduledAt).toISOString(),
          sessionType: String(formData.get("sessionType") ?? ""),
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        setCreateMessage({
          kind: "error",
          text: payload?.error ?? "Unable to create this session right now.",
        });
        setActiveAction(null);
        return;
      }

      form.reset();
      setCreateMessage({
        kind: "success",
        text: "Session created.",
      });
      router.refresh();
      setActiveAction(null);
    });
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
    sessionId: string,
  ) {
    event.preventDefault();

    const form = event.currentTarget;
    const formData = new FormData(form);
    const scheduledAt = formData.get("scheduledAt");

    if (typeof scheduledAt !== "string" || scheduledAt.length === 0) {
      setMessages((current) => ({
        ...current,
        [sessionId]: {
          kind: "error",
          text: "Choose a date and time before saving.",
        },
      }));
      return;
    }

    setActiveAction({ kind: "update", sessionId });
    setMessages((current) => ({
      ...current,
      [sessionId]: undefined,
    }));

    startTransition(async () => {
      const response = await fetch(`/api/sessions/${sessionId}`, {
        body: JSON.stringify({
          durationMinutes: Number(formData.get("durationMinutes")),
          notes: normalizeText(formData.get("notes")),
          reason: normalizeText(formData.get("reason")),
          scheduledAt: new Date(scheduledAt).toISOString(),
          sessionType: String(formData.get("sessionType") ?? ""),
          status: String(formData.get("status") ?? "scheduled"),
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        setMessages((current) => ({
          ...current,
          [sessionId]: {
            kind: "error",
            text: payload?.error ?? "Unable to save this session right now.",
          },
        }));
        setActiveAction(null);
        return;
      }

      setMessages((current) => ({
        ...current,
        [sessionId]: {
          kind: "success",
          text: "Session saved.",
        },
      }));
      router.refresh();
      setActiveAction(null);
    });
  }

  return (
    <div className="space-y-4">
      <form
        className="space-y-4 rounded-xl border border-blue-200 bg-blue-50/60 p-5 shadow-sm"
        onSubmit={handleCreateSubmit}
      >
        <div className="space-y-1 border-b border-blue-100 pb-4">
          <h2 className="text-lg font-semibold text-slate-900">Create session</h2>
          <p className="text-sm text-slate-600">
            Add a new scheduled session and save it directly to Supabase.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-sm font-medium text-slate-700">
            Client
            <select
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100"
              defaultValue={clientOptions[0]?.id ?? ""}
              disabled={clientOptions.length === 0 || createPending}
              name="clientId"
              required
            >
              {clientOptions.length === 0 ? (
                <option value="">No clients available</option>
              ) : (
                clientOptions.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-700">
            Start time
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              defaultValue={defaultCreateScheduledAt}
              disabled={createPending}
              name="scheduledAt"
              required
              type="datetime-local"
            />
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-700">
            Duration
            <select
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              defaultValue="60"
              disabled={createPending}
              name="durationMinutes"
            >
              <option value="30">30 minutes</option>
              <option value="45">45 minutes</option>
              <option value="60">60 minutes</option>
              <option value="75">75 minutes</option>
              <option value="90">90 minutes</option>
            </select>
          </label>

          <label className="space-y-2 text-sm font-medium text-slate-700">
            Gym space
            <select
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              defaultValue=""
              disabled={createPending}
              name="gymSpaceId"
            >
              <option value="">No specific space</option>
              {gymSpaceOptions.map((gymSpace) => (
                <option key={gymSpace.id} value={gymSpace.id}>
                  {gymSpace.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block space-y-2 text-sm font-medium text-slate-700">
          Session type
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            disabled={createPending}
            name="sessionType"
            placeholder="Strength training"
            required
            type="text"
          />
        </label>

        <label className="block space-y-2 text-sm font-medium text-slate-700">
          Notes
          <textarea
            className="min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            disabled={createPending}
            name="notes"
            placeholder="Optional prep details or reminders"
          />
        </label>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            {clientOptions.length === 0
              ? "Add at least one client in Supabase before creating a session."
              : "If this time is already booked, the conflict will be shown here."}
          </p>
          <div className="flex items-center gap-3">
            {createMessage ? (
              <span
                className={`text-sm ${
                  createMessage.kind === "success"
                    ? "text-emerald-700"
                    : "text-red-600"
                }`}
              >
                {createMessage.text}
              </span>
            ) : null}
            <button
              className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              disabled={clientOptions.length === 0 || createPending}
              type="submit"
            >
              {createPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Create session
            </button>
          </div>
        </div>
      </form>

      {sessions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-600">
          No scheduled sessions yet. Use the form above to create the first one.
        </div>
      ) : null}

      {sessions.map((session) => {
        const message = messages[session.id];
        const pending =
          isPending &&
          activeAction?.kind === "update" &&
          activeAction.sessionId === session.id;

        return (
          <form
            key={session.id}
            className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            onSubmit={(event) => handleSubmit(event, session.id)}
          >
            <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  {session.clientName}
                </h2>
                <p className="text-sm text-slate-600">
                  {session.sessionType} - {format(new Date(session.scheduledAt), "EEE, MMM d 'at' h:mm a")}
                </p>
                {session.gymSpaceName ? (
                  <p className="text-sm text-slate-500">{session.gymSpaceName}</p>
                ) : null}
              </div>
              <span className="inline-flex w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
                {session.status.replace("_", " ")}
              </span>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm font-medium text-slate-700">
                Start time
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  defaultValue={toDateTimeLocalValue(session.scheduledAt)}
                  name="scheduledAt"
                  required
                  type="datetime-local"
                />
              </label>

              <label className="space-y-2 text-sm font-medium text-slate-700">
                Duration
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  defaultValue={String(session.durationMinutes)}
                  name="durationMinutes"
                >
                  <option value="30">30 minutes</option>
                  <option value="45">45 minutes</option>
                  <option value="60">60 minutes</option>
                  <option value="75">75 minutes</option>
                  <option value="90">90 minutes</option>
                </select>
              </label>

              <label className="space-y-2 text-sm font-medium text-slate-700">
                Session type
                <input
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  defaultValue={session.sessionType}
                  name="sessionType"
                  required
                  type="text"
                />
              </label>

              <label className="space-y-2 text-sm font-medium text-slate-700">
                Status
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  defaultValue={session.status}
                  name="status"
                >
                  <option value="scheduled">Scheduled</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="no_show">No show</option>
                </select>
              </label>
            </div>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              Notes
              <textarea
                className="min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                defaultValue={session.notes ?? ""}
                name="notes"
                placeholder="Session notes or preparation details"
              />
            </label>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              Change reason
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                name="reason"
                placeholder="Optional note for the activity log"
                type="text"
              />
            </label>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-500">
                Last updated {format(new Date(session.updatedAt), "MMM d, h:mm a")}
              </p>
              <div className="flex items-center gap-3">
                {message ? (
                  <span
                    className={`text-sm ${
                      message.kind === "success" ? "text-emerald-700" : "text-red-600"
                    }`}
                  >
                    {message.text}
                  </span>
                ) : null}
                <button
                  className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                  disabled={pending}
                  type="submit"
                >
                  {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save changes
                </button>
              </div>
            </div>
          </form>
        );
      })}
    </div>
  );
}

function normalizeText(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getDefaultCreateDateTimeValue() {
  const date = new Date();
  date.setSeconds(0, 0);

  const minutes = date.getMinutes();
  if (minutes === 0 || minutes === 30) {
    return toDateTimeLocalValue(date);
  }

  if (minutes < 30) {
    date.setMinutes(30);
    return toDateTimeLocalValue(date);
  }

  date.setHours(date.getHours() + 1);
  date.setMinutes(0);
  return toDateTimeLocalValue(date);
}

function toDateTimeLocalValue(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
