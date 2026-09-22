import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

type ExtendedClient = ReturnType<typeof createClient>;
const globalForPrisma = globalThis as unknown as { prisma?: ExtendedClient };

// Models that support soft-delete via deletedAt (see the per-model query
// hooks below). Reads against them automatically exclude soft-deleted rows
// unless the caller passes an explicit deletedAt in `where`.
// Current coverage: progressEntry, issue, hindrance, concern, inspection,
// subContractorBill, expense, designDrawing, rfi, permit, manpowerEntry,
// tradePlan, workPermit — everything on the schema with a deletedAt column.
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
 * Postgres client via the Prisma pg driver adapter. DATABASE_URL points at
 * Neon in prod / staging, and at a local Postgres (Docker or native) in dev.
 * Same adapter for every environment — no more libsql/sqlite branching.
 */
function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required (Postgres connection string)");
  }
  const adapter = new PrismaPg({ connectionString: url });
  const base: PrismaClient = new PrismaClient({ adapter });

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
          // ProgressEntry carries a lifecycle status (DRAFT | PUBLISHED)
          // on top of the soft-delete filter. Every caller that queries
          // for "real progress" implicitly means PUBLISHED — reports,
          // rollups, DLR, the mobile list, the picker's recent tab, the
          // scorecard, everything. Rather than sprinkling
          // `status: "PUBLISHED"` at ~25 call sites we bake it into the
          // read hook, same shape as the deletedAt filter: default to
          // PUBLISHED-only, but an explicit status in `where` opts out
          // (that's how the Drafts tab reads DRAFT rows).
          if (!READ_OPERATIONS.has(operation)) return query(args);
          const a = args as AnyArgs;
          const where = { ...(a.where ?? {}) } as Record<string, unknown>;
          if (where.deletedAt === undefined) where.deletedAt = null;
          if (where.status === undefined) where.status = "PUBLISHED";
          return query({ ...a, where });
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
      expense: {
        async $allOperations({ operation, args, query }) {
          return filterDeleted(operation, args as AnyArgs, query as (a: AnyArgs) => Promise<unknown>);
        },
      },
      designDrawing: {
        async $allOperations({ operation, args, query }) {
          return filterDeleted(operation, args as AnyArgs, query as (a: AnyArgs) => Promise<unknown>);
        },
      },
      rfi: {
        async $allOperations({ operation, args, query }) {
          return filterDeleted(operation, args as AnyArgs, query as (a: AnyArgs) => Promise<unknown>);
        },
      },
      permit: {
        async $allOperations({ operation, args, query }) {
          return filterDeleted(operation, args as AnyArgs, query as (a: AnyArgs) => Promise<unknown>);
        },
      },
      manpowerEntry: {
        async $allOperations({ operation, args, query }) {
          return filterDeleted(operation, args as AnyArgs, query as (a: AnyArgs) => Promise<unknown>);
        },
      },
      tradePlan: {
        async $allOperations({ operation, args, query }) {
          return filterDeleted(operation, args as AnyArgs, query as (a: AnyArgs) => Promise<unknown>);
        },
      },
      workPermit: {
        async $allOperations({ operation, args, query }) {
          return filterDeleted(operation, args as AnyArgs, query as (a: AnyArgs) => Promise<unknown>);
        },
      },
    },
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
