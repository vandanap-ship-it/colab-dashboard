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

  // Heights chosen so the brand still feels small and refined in the chrome,
  // not a full-bleed banner.
  const wordmarkH = size === "lg" ? 44 : 26;
  const monoH = size === "lg" ? 40 : 28;

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
