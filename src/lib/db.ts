import { PrismaClient } from "@prisma/client";

const SOFT_DELETE_MODELS = new Set(["Student", "Admission", "Payment"]);

const FILTERED_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
]);

/**
 * Hides soft-deleted rows from top-level queries and rejects hard deletes.
 * To reach deleted rows, set deletedAt in the where clause.
 *
 * Nested reads are not filtered, so an `include` of these models must add
 * `where: { deletedAt: null }` itself.
 */
function createClient() {
  return new PrismaClient().$extends({
    name: "softDelete",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!SOFT_DELETE_MODELS.has(model)) return query(args);

          if (operation === "delete" || operation === "deleteMany") {
            throw new Error(`${model} records can't be hard-deleted. Set deletedAt instead.`);
          }
          if (FILTERED_OPERATIONS.has(operation)) {
            const filtered = args as { where?: Record<string, unknown> };
            filtered.where = { deletedAt: null, ...filtered.where };
          }
          return query(args);
        },
      },
    },
  });
}

type ExtendedClient = ReturnType<typeof createClient>;

const globalForPrisma = globalThis as unknown as { prisma?: ExtendedClient };

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
