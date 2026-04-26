/**
 * Stripe Payment Link — optional override via {@link process.env.NEXT_PUBLIC_STRIPE_TIP_JAR_URL} at build time.
 */
export const STRIPE_TIP_JAR_CHECKOUT_URL =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_STRIPE_TIP_JAR_URL?.trim()) ||
  "https://buy.stripe.com/eVq3cu4NRbQJeCOg446wE00";
