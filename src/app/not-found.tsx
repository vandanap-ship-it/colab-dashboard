import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-20 text-center bg-ivory">
      <p className="text-xs uppercase tracking-widest text-stone-500">404</p>
      <h1 className="text-3xl font-semibold text-stone-900 mt-2">Not found</h1>
      <p className="text-sm text-stone-500 mt-2 max-w-md">
        We couldn&apos;t find that page. Check the URL or head back to your dashboard.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-full bg-stone-900 text-white text-sm font-medium px-5 py-2"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
