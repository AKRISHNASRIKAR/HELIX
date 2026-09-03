import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="space-y-4">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="text-sm text-slate-500">
        That page or record doesn&apos;t exist.
      </p>
      <Link href="/" className="text-sm text-slate-600 hover:text-slate-900">
        ← Back to dashboard
      </Link>
    </main>
  );
}
