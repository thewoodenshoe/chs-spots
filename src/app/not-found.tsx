import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-gray-50">
      <div className="max-w-sm rounded-2xl bg-white p-8 shadow-lg text-center">
        <div className="text-5xl mb-4">🌴</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Page Not Found</h2>
        <p className="text-sm text-gray-600 mb-6">
          This spot doesn&apos;t seem to exist. Let&apos;s get you back to exploring Charleston.
        </p>
        <Link
          href="/"
          className="inline-block rounded-xl bg-teal-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
        >
          Back to Charleston Finds
        </Link>
      </div>
    </div>
  );
}
