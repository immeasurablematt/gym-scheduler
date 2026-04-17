import { format } from "date-fns";

import { getSmsDashboardData } from "@/lib/sms/dashboard";

export const dynamic = "force-dynamic";

function StatCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

export default async function ClientsPage() {
  const smsData = await getSmsDashboardData();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">
          Dashboard
        </p>
        <h1 className="mt-2 text-3xl font-bold text-slate-900">
          Clients and SMS
        </h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          Review the SMS booking feed, see which offer sets are still open, and
          confirm the first scheduling MVP is writing real activity back into
          Supabase.
        </p>
      </div>

      {!smsData.isConfigured ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-600">
          {smsData.setupIssue}
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Inbound last 7 days"
              value={smsData.stats.inboundLastWeek}
            />
            <StatCard
              label="Outbound last 7 days"
              value={smsData.stats.outboundLastWeek}
            />
            <StatCard
              label="Booked via SMS"
              value={smsData.stats.bookedLastWeek}
            />
            <StatCard
              label="Open offer sets"
              value={smsData.stats.pendingOfferSets}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.4fr,1fr]">
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-6 py-4">
                <h2 className="text-lg font-semibold text-slate-900">
                  Recent SMS activity
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Inbound and outbound messages linked to known client context
                  when available.
                </p>
              </div>
              <div className="divide-y divide-slate-100">
                {smsData.recentMessages.length === 0 ? (
                  <p className="px-6 py-8 text-sm text-slate-600">
                    No SMS activity has been logged yet.
                  </p>
                ) : (
                  smsData.recentMessages.map((message) => (
                    <div
                      key={`${message.direction}-${message.createdAt}-${message.body}`}
                      className="px-6 py-4"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        <span>{message.direction}</span>
                        <span
                          className={`rounded-full px-2 py-1 tracking-normal ${
                            message.status === "failed"
                              ? "bg-red-50 text-red-700"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {message.status}
                        </span>
                      </div>
                      <p className="mt-3 text-sm font-semibold text-slate-900">
                        {message.clientName} · {message.trainerName}
                      </p>
                      <p className="mt-2 text-sm text-slate-600">{message.body}</p>
                      <p className="mt-3 text-xs text-slate-500">
                        {format(new Date(message.createdAt), "MMM d, h:mm a")}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-6 py-4">
                <h2 className="text-lg font-semibold text-slate-900">
                  Pending offers
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  The current numbered slot sets that clients can still reply to.
                </p>
              </div>
              <div className="divide-y divide-slate-100">
                {smsData.pendingOffers.length === 0 ? (
                  <p className="px-6 py-8 text-sm text-slate-600">
                    No pending offer sets right now.
                  </p>
                ) : (
                  smsData.pendingOffers.map((offer) => (
                    <div key={offer.offerSetId} className="px-6 py-4">
                      <p className="text-sm font-semibold text-slate-900">
                        {offer.clientName} · {offer.trainerName}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Offered {format(new Date(offer.createdAt), "MMM d, h:mm a")}
                      </p>
                      <div className="mt-3 space-y-2">
                        {offer.slots.map((slot) => (
                          <div
                            key={`${offer.offerSetId}-${slot}`}
                            className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700"
                          >
                            {slot}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
