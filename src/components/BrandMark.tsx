import Image from "next/image";
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
  // The wordmark SVG includes the "Siddhi." text in italic serif with the gold
  // accent dot — so when showWordmark is true we render only the wordmark.
  // When showWordmark is false (tight spots like mobile project header) we
  // render the square "S." monogram.

  // Heights: 32 in the chrome (up from 26 — Shraddha wanted more presence),
  // 44 in the login / marketing "lg" contexts. Monogram tracks close so the
  // "S." reads as the same brand at either size.
  const wordmarkH = size === "lg" ? 48 : 32;
  const monoH = size === "lg" ? 44 : 32;

  const inner = showWordmark ? (
    <Image
      src="/siddhi-wordmark.svg"
      alt="Siddhi"
      width={Math.round(wordmarkH * (483 / 252))}
      height={wordmarkH}
      priority
      className="inline-block select-none"
    />
  ) : (
    <Image
      src="/siddhi-monogram.svg"
      alt="Siddhi"
      width={Math.round(monoH * (320 / 491))}
      height={monoH}
      priority
      className="inline-block select-none"
    />
  );

  if (href === null) return inner;
  return (
    <Link href={href} className="inline-flex items-center hover:opacity-80 transition-opacity">
      {inner}
    </Link>
  );
}
