import type { PayPalCapture, PayPalOrder } from "@/lib/payments/paypal";

export const orderId = "00000000-0000-4000-8000-000000000001";
export const localOrder = {
  id: orderId, userId: "buyer", provider: "paypal", requestId: "request-1", packKey: "pack_200",
  amountCents: 500, currency: "usd", credits: 200, merchantId: "merchant", environment: "sandbox",
  locale: "en", providerOrderId: "REMOTE", approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=REMOTE",
  status: "created", paymentId: null, createdAt: new Date(), updatedAt: new Date(),
};
export const capture: PayPalCapture = {
  id: "CAPTURE", status: "COMPLETED", amount: { currency_code: "USD", value: "5.00" },
  payee: { merchant_id: "merchant" }, custom_id: orderId,
  supplementary_data: { related_ids: { order_id: "REMOTE" } },
};
export const remoteOrder: PayPalOrder = {
  id: "REMOTE", status: "COMPLETED", intent: "CAPTURE", purchase_units: [{
    reference_id: orderId, custom_id: orderId,
    amount: { currency_code: "USD", value: "5.00" }, payee: { merchant_id: "merchant" },
    payments: { captures: [capture] },
  }],
};
