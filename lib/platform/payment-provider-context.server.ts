import { AsyncLocalStorage } from "node:async_hooks";

import * as stripe from "./stripe.server";

export type PaymentProvider = {
  createCheckoutSession: typeof stripe.createCheckoutSession;
  expireCheckoutSession: typeof stripe.expireCheckoutSession;
  listPaymentRefunds: typeof stripe.listPaymentRefunds;
  refundPayment: typeof stripe.refundPayment;
  retrievePaymentBalance: typeof stripe.retrievePaymentBalance;
  retrievePaymentMetadata: typeof stripe.retrievePaymentMetadata;
  retrieveSession: typeof stripe.retrieveSession;
};

export const stripePaymentProvider: PaymentProvider = {
  createCheckoutSession: (...args) => stripe.createCheckoutSession(...args),
  expireCheckoutSession: (...args) => stripe.expireCheckoutSession(...args),
  listPaymentRefunds: (...args) => stripe.listPaymentRefunds(...args),
  refundPayment: (...args) => stripe.refundPayment(...args),
  retrievePaymentBalance: (...args) => stripe.retrievePaymentBalance(...args),
  retrievePaymentMetadata: (...args) => stripe.retrievePaymentMetadata(...args),
  retrieveSession: (...args) => stripe.retrieveSession(...args),
};

const activePaymentProvider = new AsyncLocalStorage<PaymentProvider>();

export function withPaymentProvider<A>(
  provider: PaymentProvider,
  run: () => Promise<A>,
): Promise<A> {
  return activePaymentProvider.run(provider, run);
}

function current(): PaymentProvider {
  return activePaymentProvider.getStore() ?? stripePaymentProvider;
}

export const createCheckoutSession: PaymentProvider["createCheckoutSession"] = (...args) =>
  current().createCheckoutSession(...args);
export const expireCheckoutSession: PaymentProvider["expireCheckoutSession"] = (...args) =>
  current().expireCheckoutSession(...args);
export const listPaymentRefunds: PaymentProvider["listPaymentRefunds"] = (...args) =>
  current().listPaymentRefunds(...args);
export const refundPayment: PaymentProvider["refundPayment"] = (...args) =>
  current().refundPayment(...args);
export const retrievePaymentBalance: PaymentProvider["retrievePaymentBalance"] = (...args) =>
  current().retrievePaymentBalance(...args);
export const retrievePaymentMetadata: PaymentProvider["retrievePaymentMetadata"] = (...args) =>
  current().retrievePaymentMetadata(...args);
export const retrieveSession: PaymentProvider["retrieveSession"] = (...args) =>
  current().retrieveSession(...args);
