import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaLibSql } from "@prisma/adapter-libsql";

type ExtendedClient = ReturnType<typeof createClient>;
const globalForPrisma = globalThis as unknown as { prisma?: ExtendedClient };

// Models that support soft-delete via deletedAt: progressEntry, issue,
// hindrance, concern, inspection, subContractorBill (see the per-model query
// hooks below). Reads against them automatically exclude soft-deleted rows
// unless the caller passes an explicit deletedAt in `where`.
const READ_OPERATIONS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);

/**
 * Pick the database adapter based on DATABASE_URL.
 *
 *   libsql://...  (or has TURSO_AUTH_TOKEN set)  → libsql adapter (Turso, prod)
 *   file:./...    or unset                       → better-sqlite3 (local dev)
 */
function createClient() {
  const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db";

  let base: PrismaClient;
  if (url.startsWith("libsql://") || url.startsWith("https://")) {
    const adapter = new PrismaLibSql({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    base = new PrismaClient({ adapter });
  } else {
    const fileUrl = url.startsWith("file:") ? url.slice("file:".length) : url;
    const adapter = new PrismaBetterSqlite3({ url: fileUrl });
    base = new PrismaClient({ adapter });
  }

  // Soft-delete extension: for each model, hijack read operations to filter
  // out rows where deletedAt is set, unless the caller explicitly opts out
  // by passing { deletedAt: { not: null } } or { deletedAt: ... } in where.
  type AnyArgs = { where?: Record<string, unknown> } & Record<string, unknown>;
  const filterDeleted = async (
    operation: string,
    args: AnyArgs,
    query: (a: AnyArgs) => Promise<unknown>,
  ) => {
    if (!READ_OPERATIONS.has(operation)) return query(args);
    const where = (args.where ?? {}) as Record<string, unknown>;
    if (where.deletedAt === undefined) {
      return query({ ...args, where: { ...where, deletedAt: null } });
    }
    return query(args);
  };

  return base.$extends({
    name: "softDelete",
    query: {
      progressEntry: {
        async $allOperations({ operation, args, query }) {
          return filterDeleted(operation, args as AnyArgs, query as (a: AnyArgs) => Promise<unknown>);
        },
      },
      issue: {
        async $allOperations({ operation, args, query }) {
          return filterDeleted(operation, args as AnyArgs, query as (a: AnyArgs) => Promise<unknown>);
        },
      },
      hindrance: {
        async $allOperations({ operation, args, query }) {
          return filterDeleted(operation, args as AnyArgs, query as (a: AnyArgs) => Promise<unknown>);
        },
      },
      concern: {
        async $allOperations({ operation, args, query }) {
          return filterDeleted(operation, args as AnyArgs, query as (a: AnyArgs) => Promise<unknown>);
        },
      },
      inspection: {
        async $allOperations({ operation, args, query }) {
          return filterDeleted(operation, args as AnyArgs, query as (a: AnyArgs) => Promise<unknown>);
        },
      },
      subContractorBill: {
        async $allOperations({ operation, args, query }) {
          return filterDeleted(operation, args as AnyArgs, query as (a: AnyArgs) => Promise<unknown>);
        },
      },
    },
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
