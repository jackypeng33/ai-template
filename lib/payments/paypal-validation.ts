import { PayPalError, type PayPalCapture, type PayPalOrder } from "./paypal";

export type PayPalOrderSnapshot = {
  id: string; providerOrderId: string | null; amountCents: number; currency: string; merchantId: string;
};

export function amountToCents(value: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new PayPalError(409, "PAYPAL_AMOUNT_MISMATCH");
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new PayPalError(409, "PAYPAL_AMOUNT_MISMATCH");
  return cents;
}

export function validatePayPalOrder(local: PayPalOrderSnapshot, remote: PayPalOrder) {
  const unit = remote.purchase_units[0];
  if (remote.intent !== "CAPTURE" || remote.purchase_units.length !== 1 || !unit ||
      (local.providerOrderId && remote.id !== local.providerOrderId) ||
      unit.custom_id !== local.id || unit.reference_id !== local.id ||
      unit.payee?.merchant_id !== local.merchantId ||
      unit.amount.currency_code !== local.currency.toUpperCase() ||
      amountToCents(unit.amount.value) !== local.amountCents) {
    throw new PayPalError(409, "PAYPAL_ORDER_MISMATCH");
  }
}

export function validatePayPalCapture(local: PayPalOrderSnapshot, remote: PayPalOrder, capture: PayPalCapture) {
  validatePayPalOrder(local, remote);
  const captures = remote.purchase_units[0].payments?.captures ?? [];
  if (remote.status !== "COMPLETED" || capture.status !== "COMPLETED" ||
      captures.length !== 1 || captures[0].id !== capture.id ||
      capture.supplementary_data?.related_ids?.order_id !== remote.id ||
      capture.payee?.merchant_id !== local.merchantId ||
      (capture.custom_id !== undefined && capture.custom_id !== local.id) ||
      capture.amount.currency_code !== local.currency.toUpperCase() ||
      amountToCents(capture.amount.value) !== local.amountCents) {
    throw new PayPalError(409, "PAYPAL_CAPTURE_MISMATCH");
  }
}
