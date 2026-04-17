import Link from "next/link";

type AuthConfigCardProps = {
  title: string;
  description: string;
};

export function AuthConfigCard({ title, description }: AuthConfigCardProps) {
  return (
    <div className="w-full max-w-lg rounded-2xl border border-amber-200 bg-white p-8 shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-600">
        Local setup needed
      </p>
      <h1 className="mt-3 text-3xl font-bold text-slate-900">{title}</h1>
      <p className="mt-3 text-slate-600">{description}</p>
      <div className="mt-6 rounded-xl bg-amber-50 p-4 text-sm text-slate-700">
        Add your Clerk keys to <code>.env.local</code> to enable authentication
        screens and protected routes.
      </div>
      <div className="mt-6 flex gap-3">
        <Link
          href="/"
          className="rounded-lg bg-slate-900 px-4 py-2 font-medium text-white transition hover:bg-slate-800"
        >
          Back Home
        </Link>
        <Link
          href="/dashboard"
          className="rounded-lg border border-slate-300 px-4 py-2 font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Preview Dashboard
        </Link>
      </div>
    </div>
  );
}
