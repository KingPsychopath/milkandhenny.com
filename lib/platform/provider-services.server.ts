import { Context, Data, Effect, Layer } from "effect";
import type { QueryResultRow } from "pg";

import { deliverEmailNow } from "./email.server";
import { withOperationSignal } from "./operation-context.server";
import { stripePaymentProvider, type PaymentProvider } from "./payment-provider-context.server";
import {
  r2ObjectStorageProvider,
  type ObjectStorageProvider,
} from "./object-storage-provider-context.server";
import * as postgres from "./postgres.server";
import { nodePostgresProvider, type PostgresProvider } from "./postgres-provider-context.server";
import * as r2 from "./r2.server";
import { getRedis } from "./redis.server";
import * as stripe from "./stripe.server";

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
    readonly query: <T extends QueryResultRow>(
      text: string,
      values?: readonly unknown[],
    ) => Effect.Effect<T[], InfrastructureError>;
    readonly transaction: <T>(
      run: Parameters<typeof postgres.transaction<T>>[0],
    ) => Effect.Effect<T, InfrastructureError>;
    readonly port: PostgresProvider;
  }
>()("PostgresService") {
  static readonly layer = Layer.succeed(this, {
    port: nodePostgresProvider,
    query: <T extends QueryResultRow>(text: string, values: readonly unknown[] = []) =>
      attempt("postgres", "query", () => nodePostgresProvider.query<T>(text, values)),
    transaction: <T>(run: Parameters<typeof postgres.transaction<T>>[0]) =>
      attempt("postgres", "transaction", () => nodePostgresProvider.transaction(run)),
  });
}

/** Provider delivery only. Durable queue ownership remains in Postgres. */
export class EmailProviderService extends Context.Service<
  EmailProviderService,
  {
    readonly send: typeof deliverEmailNow;
    readonly deliver: (
      ...args: Parameters<typeof deliverEmailNow>
    ) => Effect.Effect<Awaited<ReturnType<typeof deliverEmailNow>>, InfrastructureError>;
  }
>()("EmailProviderService") {
  static readonly layer = Layer.succeed(this, {
    send: deliverEmailNow,
    deliver: (...args: Parameters<typeof deliverEmailNow>) =>
      attempt("email", "deliver", () => deliverEmailNow(...args)),
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
    readonly createCheckout: (
      ...args: Parameters<typeof stripe.createCheckoutSession>
    ) => Effect.Effect<
      Awaited<ReturnType<typeof stripe.createCheckoutSession>>,
      InfrastructureError
    >;
    readonly expireCheckout: (
      ...args: Parameters<typeof stripe.expireCheckoutSession>
    ) => Effect.Effect<
      Awaited<ReturnType<typeof stripe.expireCheckoutSession>>,
      InfrastructureError
    >;
    readonly listRefunds: (
      ...args: Parameters<typeof stripe.listPaymentRefunds>
    ) => Effect.Effect<Awaited<ReturnType<typeof stripe.listPaymentRefunds>>, InfrastructureError>;
    readonly port: PaymentProvider;
    readonly refund: (
      ...args: Parameters<typeof stripe.refundPayment>
    ) => Effect.Effect<Awaited<ReturnType<typeof stripe.refundPayment>>, InfrastructureError>;
    readonly retrievePaymentBalance: (
      ...args: Parameters<typeof stripe.retrievePaymentBalance>
    ) => Effect.Effect<
      Awaited<ReturnType<typeof stripe.retrievePaymentBalance>>,
      InfrastructureError
    >;
    readonly retrieveSession: (
      ...args: Parameters<typeof stripe.retrieveSession>
    ) => Effect.Effect<Awaited<ReturnType<typeof stripe.retrieveSession>>, InfrastructureError>;
    readonly retrievePaymentMetadata: (
      ...args: Parameters<typeof stripe.retrievePaymentMetadata>
    ) => Effect.Effect<
      Awaited<ReturnType<typeof stripe.retrievePaymentMetadata>>,
      InfrastructureError
    >;
  }
>()("PaymentsService") {
  static readonly layer = Layer.succeed(this, {
    createCheckout: (...args: Parameters<typeof stripe.createCheckoutSession>) =>
      attempt("stripe", "create_checkout", () =>
        stripePaymentProvider.createCheckoutSession(...args),
      ),
    expireCheckout: (...args: Parameters<typeof stripe.expireCheckoutSession>) =>
      attempt("stripe", "expire_checkout", () =>
        stripePaymentProvider.expireCheckoutSession(...args),
      ),
    listRefunds: (...args: Parameters<typeof stripe.listPaymentRefunds>) =>
      attempt("stripe", "list_refunds", () => stripePaymentProvider.listPaymentRefunds(...args)),
    port: stripePaymentProvider,
    refund: (...args: Parameters<typeof stripe.refundPayment>) =>
      attempt("stripe", "refund", () => stripePaymentProvider.refundPayment(...args)),
    retrievePaymentBalance: (...args: Parameters<typeof stripe.retrievePaymentBalance>) =>
      attempt("stripe", "retrieve_balance", () =>
        stripePaymentProvider.retrievePaymentBalance(...args),
      ),
    retrievePaymentMetadata: (...args: Parameters<typeof stripe.retrievePaymentMetadata>) =>
      attempt("stripe", "retrieve_metadata", () =>
        stripePaymentProvider.retrievePaymentMetadata(...args),
      ),
    retrieveSession: (...args: Parameters<typeof stripe.retrieveSession>) =>
      attempt("stripe", "retrieve_session", () => stripePaymentProvider.retrieveSession(...args)),
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

export const infrastructureServicesLayer = Layer.mergeAll(
  PostgresService.layer,
  EmailProviderService.layer,
  ObjectStorageService.layer,
  PaymentsService.layer,
  RedisService.layer,
);
