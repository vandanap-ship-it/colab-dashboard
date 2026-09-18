import { headers } from "next/headers";
import { cookies } from "next/headers";

/**
 * Phone-shaped device detection for the server side of the app.
 *
 * Planners and Product-Team accounts have full access, so their default
 * landing (see `defaultLandingFor` in roles.ts) is the desktop projects
 * table. That's the right call when they open the app on a laptop — but
 * on a phone they land on a desktop UI cramped into a 375px viewport,
 * which reads as "the app is broken".
 *
 * This helper reads the request's User-Agent header and returns true for
 * phone-shaped devices (Android phones, iPhones). We do NOT include
 * iPads: an iPad has enough width to render the desktop tables usefully
 * and the desktop UI is what a planner opening it on iPad expects.
 *
 * Escape hatch: an explicit `?ui=desktop` on the URL, or a
 * `siddhi-ui-preference=desktop` cookie, forces the desktop UI regardless.
 * The mobile home can also link back to `/?ui=desktop` for a planner who
 * knows what they want.
 */
export async function isPhoneRequest(): Promise<boolean> {
  const hdrs = await headers();
  const ua = (hdrs.get("user-agent") ?? "").toLowerCase();

  // Cheap positive test — the common phone tokens land in every mobile
  // browser's UA (iPhone, Android + Mobile, Opera Mini, Windows Phone).
  // The "iPad" carve-out is deliberate: iPadOS lies and reports itself as
  // Macintosh + Safari (no "iPad" token) since iPadOS 13, which we don't
  // catch here anyway — but we DO catch the older iPad UAs and drop them
  // so an iPad user gets the desktop view.
  const looksPhone =
    ua.includes("iphone") ||
    (ua.includes("android") && ua.includes("mobile")) ||
    ua.includes("windows phone") ||
    ua.includes("opera mini") ||
    ua.includes("mobile safari");
  const looksTabletThatShouldGetDesktop =
    ua.includes("ipad") || ua.includes("tablet");
  if (looksTabletThatShouldGetDesktop) return false;

  return looksPhone;
}

/**
 * True when the user has explicitly opted OUT of the mobile redirect —
 * either by passing `?ui=desktop` on the request URL or via the sticky
 * `siddhi-ui-preference=desktop` cookie set by the desktop escape hatch.
 *
 * We do NOT persist a mobile preference cookie: mobile UX is derived from
 * the device shape, so re-forcing it on every navigation is meaningless.
 */
export async function hasDesktopPreference(searchParams: {
  ui?: string;
} = {}): Promise<boolean> {
  if (searchParams.ui === "desktop") return true;
  const c = await cookies();
  return c.get("siddhi-ui-preference")?.value === "desktop";
}
