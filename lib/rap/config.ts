export const RAP_PRODUCT = {
  name: "BOOTH", key: "booth-duo-v1", templateVersion: "orange-booth-en-v1",
  priceCents: 599, currency: "usd", duration: 8, resolution: "720p", aspectRatio: "9:16",
  model: "bytedance/seedance-2-mini", musicPath: "/rap/booth-original-v1.wav",
  lyrics: "Two faces, one beat. Step in, feel the heat. Side by side, we shine. Your crew, your time.",
  maxImageBytes: 10 * 1024 * 1024, draftHours: 24, reviewMinutes: 30,
  videoDays: 7, terminalPhotoHours: 24, unknownPhotoDays: 7,
} as const;

export class RapError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}

export function rapGenerationEnabled() {
  // A provider key alone never authorizes paid generation. Default is OFF.
  return process.env.RAP_VIDEO_GENERATION_ENABLED === "true";
}

export function rapCheckoutReady() {
  return rapGenerationEnabled() && process.env.RAP_CHECKOUT_ENABLED === "true" &&
    process.env.RAP_QUALITY_APPROVED === "true" && process.env.RAP_MUSIC_RIGHTS_APPROVED === "true" &&
    Boolean(process.env.KIE_API_KEY && process.env.CRON_SECRET && process.env.RESEND_API_KEY && process.env.RAP_SUPPORT_EMAIL && process.env.RAP_PAYPAL_WEBHOOK_ID) &&
    (process.env.NODE_ENV !== "production" || Boolean(process.env.RAP_STORAGE_BUCKET &&
      process.env.STORAGE_ACCESS_KEY_ID && process.env.STORAGE_SECRET_ACCESS_KEY && process.env.STORAGE_ENDPOINT));
}

export function assertRapCheckoutReady() {
  if (!rapCheckoutReady()) throw new RapError(503, "CHECKOUT_NOT_OPEN");
}

export const rapPrompt = `An 8 second portrait 9:16 single continuous medium shot. Two adult people in a warm orange recording booth, one suspended microphone between them. The person in reference image 1 is on the left and sings the supplied reference audio. The person in reference image 2 is on the right, mouth closed, gently nodding to the beat. Preserve each person's distinct face, hairstyle and clothing. Do not swap identities, merge faces, add a third person, or crop their faces. Left singer mouths these lyrics in time with the reference: "${RAP_PRODUCT.lyrics}". Small natural gestures. No cuts, no captions, no text, no logos. Match the reference rhythm and vocal content; keep the native generated audio.`;
