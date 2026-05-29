import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { refreshTokenFromDb } from "@/lib/authToken";

// How often (ms) to re-check a session against the DB. Defaults to the lib's
// 60s; overridable via AUTH_REVALIDATE_MS (e.g. "0" in E2E to revalidate every
// request, or to tune the deactivation-enforcement delay in production).
const REVALIDATE_MS =
  process.env.AUTH_REVALIDATE_MS !== undefined
    ? Math.max(0, parseInt(process.env.AUTH_REVALIDATE_MS, 10) || 0)
    : undefined;

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      username: string;
      modules: string | null;
    } & DefaultSession["user"];
  }
  interface User {
    role: string;
    username: string;
    modules: string | null;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Trust the request host so the app works over LAN IPs (phone testing) and
  // behind reverse proxies. NextAuth v5 otherwise refuses to set cookies on
  // hosts other than localhost.
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(creds) {
        const username = (creds?.username ?? "").toString().trim().toLowerCase();
        const password = (creds?.password ?? "").toString();
        if (!username || !password) return null;

        const user = await prisma.user.findUnique({ where: { username } });
        if (!user || !user.active) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          name: user.name,
          username: user.username,
          role: user.role,
          modules: user.modules ?? null,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Initial sign-in: trust the authorize() result and stamp the token.
        token.id = user.id as string;
        token.role = (user as { role: string }).role;
        token.username = (user as { username: string }).username;
        token.modules = (user as { modules: string | null }).modules ?? null;
        token.validatedAt = Date.now();
        return token;
      }
      // Subsequent requests: re-check the DB so deactivation and role/module
      // changes take effect promptly instead of waiting for the token to expire.
      // Returning null drops the session (NextAuth clears the cookie).
      return refreshTokenFromDb(
        token,
        (id) =>
          prisma.user
            .findUnique({
              where: { id },
              select: { active: true, role: true, username: true, modules: true },
            })
            .then((u) =>
              u ? { active: u.active, role: u.role, username: u.username, modules: u.modules ?? null } : null,
            ),
        { now: Date.now(), intervalMs: REVALIDATE_MS },
      );
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        session.user.username = token.username as string;
        session.user.modules = (token.modules as string | null) ?? null;
      }
      return session;
    },
    /**
     * Redirect callback — keep redirects on the same host as the incoming
     * request. Without this, NextAuth sometimes pins to localhost even when
     * the request came from a LAN IP, breaking phone-on-WiFi testing.
     */
    async redirect({ url, baseUrl }) {
      try {
        if (url.startsWith("/")) return `${baseUrl}${url}`;
        const target = new URL(url);
        const base = new URL(baseUrl);
        // Same host as the incoming request: trust it.
        if (target.host === base.host) return url;
      } catch {
        // Fall through to baseUrl.
      }
      return baseUrl;
    },
  },
});
