import { Context, Data, Effect, Layer } from "effect";

import { deliverEmailNow } from "./email.server";
import { withOperationSignal } from "./operation-context.server";
import { stripePaymentProvider, type PaymentProvider } from "./payment-provider-context.server";
import {
  r2ObjectStorageProvider,
  type ObjectStorageProvider,
} from "./object-storage-provider-context.server";
import { nodePostgresProvider, type PostgresProvider } from "./postgres-provider-context.server";
import * as r2 from "./r2.server";
import { getRedis } from "./redis.server";

export type InfrastructureProvider = "email" | "postgres" | "r2" | "redis" | "stripe";

export class InfrastructureError extends Data.TaggedError("InfrastructureError")<{
  readonly cause: unknown;
  readonly operation: string;
  readonly provider: InfrastructureProvider;
}> {}

function attempt<A>(
  provider: InfrastructureProvider,
  operation: string,
  run: (signal: AbortSignal) => Promise<A>,
) {
  return Effect.tryPromise({
    try: (signal) => withOperationSignal(signal, () => run(signal)),
    catch: (cause) => new InfrastructureError({ cause, operation, provider }),
  }).pipe(
    Effect.withSpan(`infrastructure.${provider}.${operation}`, {
      attributes: { operation, provider },
    }),
  );
}

/** Injectable Postgres boundary. Product repositories remain ordinary async functions. */
export class PostgresService extends Context.Service<
  PostgresService,
  {
    readonly port: PostgresProvider;
  }
>()("PostgresService") {
  static readonly layer = Layer.succeed(this, {
    port: nodePostgresProvider,
  });
}

/** Provider delivery only. Durable queue ownership remains in Postgres. */
export class EmailProviderService extends Context.Service<
  EmailProviderService,
  {
    readonly send: typeof deliverEmailNow;
  }
>()("EmailProviderService") {
  static readonly layer = Layer.succeed(this, {
    send: deliverEmailNow,
  });
}

/** R2 stays an SDK adapter; orchestration consumes this replaceable Effect service. */
export class ObjectStorageService extends Context.Service<
  ObjectStorageService,
  {
    readonly deleteObject: (
      ...args: Parameters<typeof r2.deleteObject>
    ) => Effect.Effect<void, InfrastructureError>;
    readonly deleteObjects: (
      ...args: Parameters<typeof r2.deleteObjects>
    ) => Effect.Effect<number, InfrastructureError>;
    readonly headObject: (
      ...args: Parameters<typeof r2.headObject>
    ) => Effect.Effect<Awaited<ReturnType<typeof r2.headObject>>, InfrastructureError>;
    readonly listObjects: (
      ...args: Parameters<typeof r2.listObjects>
    ) => Effect.Effect<Awaited<ReturnType<typeof r2.listObjects>>, InfrastructureError>;
    readonly listPrefixes: (
      ...args: Parameters<typeof r2.listPrefixes>
    ) => Effect.Effect<Awaited<ReturnType<typeof r2.listPrefixes>>, InfrastructureError>;
    readonly presignGetUrl: (
      ...args: Parameters<typeof r2.presignGetUrl>
    ) => Effect.Effect<string, InfrastructureError>;
    readonly presignPutUrl: (
      ...args: Parameters<typeof r2.presignPutUrl>
    ) => Effect.Effect<string, InfrastructureError>;
    readonly port: ObjectStorageProvider;
  }
>()("ObjectStorageService") {
  static readonly layer = Layer.succeed(this, {
    deleteObject: (...args: Parameters<typeof r2.deleteObject>) =>
      attempt("r2", "delete_object", () => r2ObjectStorageProvider.deleteObject(...args)),
    deleteObjects: (...args: Parameters<typeof r2.deleteObjects>) =>
      attempt("r2", "delete_objects", () => r2ObjectStorageProvider.deleteObjects(...args)),
    headObject: (...args: Parameters<typeof r2.headObject>) =>
      attempt("r2", "head_object", () => r2ObjectStorageProvider.headObject(...args)),
    listObjects: (...args: Parameters<typeof r2.listObjects>) =>
      attempt("r2", "list_objects", () => r2ObjectStorageProvider.listObjects(...args)),
    listPrefixes: (...args: Parameters<typeof r2.listPrefixes>) =>
      attempt("r2", "list_prefixes", () => r2ObjectStorageProvider.listPrefixes(...args)),
    port: r2ObjectStorageProvider,
    presignGetUrl: (...args: Parameters<typeof r2.presignGetUrl>) =>
      attempt("r2", "presign_get", () => r2ObjectStorageProvider.presignGetUrl(...args)),
    presignPutUrl: (...args: Parameters<typeof r2.presignPutUrl>) =>
      attempt("r2", "presign_put", () => r2ObjectStorageProvider.presignPutUrl(...args)),
  });
}

/** Stripe policies remain in tickets; this is the replaceable provider capability. */
export class PaymentsService extends Context.Service<
  PaymentsService,
  {
    readonly port: PaymentProvider;
  }
>()("PaymentsService") {
  static readonly layer = Layer.succeed(this, {
    port: stripePaymentProvider,
  });
}

/** Redis commands stay in repositories; this service makes client acquisition injectable. */
export class RedisService extends Context.Service<
  RedisService,
  {
    readonly client: Effect.Effect<ReturnType<typeof getRedis>, InfrastructureError>;
  }
>()("RedisService") {
  static readonly layer = Layer.succeed(this, {
    client: Effect.try({
      try: getRedis,
      catch: (cause) => new InfrastructureError({ cause, operation: "client", provider: "redis" }),
    }),
  });
}
