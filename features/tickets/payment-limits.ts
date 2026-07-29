// Stripe rejects lower card totals before creating a Checkout Session.
const CHECKOUT_MINIMUMS_MINOR: Readonly<Record<string, number>> = {
  GBP: 30,
};

export function getCheckoutMinimumMinor(currency: string): number | undefined {
  return CHECKOUT_MINIMUMS_MINOR[currency.toUpperCase()];
}

export function minimumCheckoutQuantity(priceMinor: number, currency: string): number {
  const minimum = getCheckoutMinimumMinor(currency);
  if (!minimum || priceMinor <= 0) return 1;
  return Math.ceil(minimum / priceMinor);
}

export function isCheckoutTotalSupported(
  priceMinor: number,
  quantity: number,
  currency: string,
): boolean {
  const minimum = getCheckoutMinimumMinor(currency);
  return minimum === undefined || priceMinor * quantity >= minimum;
}
