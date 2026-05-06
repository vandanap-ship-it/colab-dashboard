import Link from "next/link";

export default function BrandMark({
  size = "sm",
  href = "/",
  showWordmark = true,
}: {
  size?: "sm" | "lg";
  href?: string | null;
  showWordmark?: boolean;
}) {
  const dim = size === "lg" ? "w-9 h-9" : "w-7 h-7";
  const text = size === "lg" ? "text-base" : "text-sm";

  const inner = (
    <span className="inline-flex items-center gap-2">
      <span
        className={`${dim} rounded-lg bg-stone-900 flex items-center justify-center shadow-soft`}
      >
        <svg
          viewBox="0 0 16 16"
          className={size === "lg" ? "w-5 h-5" : "w-4 h-4"}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden
        >
          <rect x="2" y="2" width="5" height="5" rx="1" fill="#FBBF24" />
          <rect x="9" y="2" width="5" height="5" rx="1" fill="white" opacity="0.7" />
          <rect x="2" y="9" width="5" height="5" rx="1" fill="white" opacity="0.5" />
          <rect x="9" y="9" width="5" height="5" rx="1" fill="white" opacity="0.85" />
        </svg>
      </span>
      {showWordmark && (
        <span className={`font-semibold tracking-tight text-stone-900 ${text}`}>
          Siddhi
        </span>
      )}
    </span>
  );

  if (href === null) return inner;
  return (
    <Link href={href} className="inline-flex items-center hover:opacity-80 transition-opacity">
      {inner}
    </Link>
  );
}
