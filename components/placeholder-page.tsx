import Link from "next/link";

type PlaceholderPageProps = {
  eyebrow: string;
  title: string;
  description: string;
};

export function PlaceholderPage({
  eyebrow,
  title,
  description,
}: PlaceholderPageProps) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-[0.24em] text-blue-600">
        {eyebrow}
      </p>
      <h1 className="mt-3 text-3xl font-bold text-slate-900">{title}</h1>
      <p className="mt-3 max-w-2xl text-slate-600">{description}</p>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl bg-slate-50 p-5">
          <h2 className="text-lg font-semibold text-slate-900">Suggested next build</h2>
          <p className="mt-2 text-sm text-slate-600">
            Replace this placeholder with real data fetching, controls, and any
            role-specific actions that belong in this area.
          </p>
        </div>
        <div className="rounded-2xl bg-blue-50 p-5">
          <h2 className="text-lg font-semibold text-slate-900">Testing value</h2>
          <p className="mt-2 text-sm text-slate-600">
            This route exists now, so navigation, auth checks, and smoke tests
            can cover it without hitting a 404.
          </p>
        </div>
      </div>
      <div className="mt-8">
        <Link
          href="/dashboard"
          className="inline-flex rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700"
        >
          Back to Dashboard
        </Link>
      </div>
    </section>
  );
}
