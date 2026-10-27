import { pgTable, text, timestamp, boolean, integer, varchar, index, uniqueIndex } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  // total available credits for the user
  credits: integer("credits").default(0).notNull(),
  // user role: 'admin' | 'user'
  role: text("role").default("user").notNull(),
  // current subscription plan
  planKey: text("plan_key").default("free"),
  // ban status
  banned: boolean("banned").default(false).notNull(),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .$onUpdate(() => new Date())
    .notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .$onUpdate(() => new Date())
    .notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// Payment records (one-time purchases and subscription renewals)
export const payment = pgTable("payment", {
  id: text("id").primaryKey(),
  provider: varchar("provider", { length: 32 }).default("creem").notNull(),
  providerPaymentId: text("provider_payment_id").notNull().unique(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  currency: varchar("currency", { length: 8 }).default("usd").notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  type: varchar("type", { length: 32 }).notNull(), // 'one_time' | 'subscription'
  planKey: varchar("plan_key", { length: 64 }),
  creditsGranted: integer("credits_granted").default(0).notNull(),
  raw: text("raw"), // store provider payload as JSON string
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Orders snapshot the catalog before contacting PayPal. External calls must never
// run inside the balance/ledger transaction. Creem keeps its existing flow.
export const billingOrder = pgTable("billing_order", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 32 }).notNull(),
  requestId: text("request_id").notNull(),
  packKey: text("pack_key").notNull(),
  amountCents: integer("amount_cents").notNull(),
  currency: varchar("currency", { length: 8 }).notNull(),
  credits: integer("credits").notNull(),
  merchantId: text("merchant_id").notNull(),
  environment: varchar("environment", { length: 16 }).notNull(),
  locale: varchar("locale", { length: 8 }).notNull(),
  providerOrderId: text("provider_order_id").unique(),
  approvalUrl: text("approval_url"),
  status: varchar("status", { length: 32 }).default("created").notNull(),
  paymentId: text("payment_id").references(() => payment.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
}, table => ({
  requestIdx: uniqueIndex("billing_order_user_request_idx").on(table.userId, table.requestId),
  userIdx: index("billing_order_user_idx").on(table.userId, table.createdAt),
}));

// Store only reconciliation identifiers, not the buyer's full personal payload.
export const paymentEvent = pgTable("payment_event", {
  id: text("id").primaryKey(), // provider:eventId
  provider: varchar("provider", { length: 32 }).notNull(),
  eventType: text("event_type").notNull(),
  providerOrderId: text("provider_order_id"),
  providerSubscriptionId: text("provider_subscription_id"),
  resourceId: text("resource_id"),
  status: varchar("status", { length: 32 }).default("received").notNull(),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
});

// Active subscriptions
export const subscription = pgTable("subscription", {
  id: text("id").primaryKey(),
  provider: varchar("provider", { length: 32 }).default("creem").notNull(),
  providerSubId: text("provider_sub_id").notNull().unique(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  planKey: varchar("plan_key", { length: 64 }).notNull(),
  status: varchar("status", { length: 32 }).notNull(),
  currentPeriodEnd: timestamp("current_period_end"),
  // PayPal: currentPeriodEnd is the PAID entitlement end, not the next charge.
  checkoutRequestId: text("checkout_request_id"),
  billingSnapshot: text("billing_snapshot"),
  approvalUrl: text("approval_url"),
  locale: varchar("locale", { length: 8 }),
  nextBillingAt: timestamp("next_billing_at"),
  providerUpdatedAt: timestamp("provider_updated_at"),
  providerCheckedAt: timestamp("provider_checked_at"),
  transactionsCheckedThrough: timestamp("transactions_checked_through"),
  billingReview: boolean("billing_review").default(false).notNull(),
  raw: text("raw"), // store provider payload as JSON string
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
}, table => ({
  checkoutIdx: uniqueIndex("subscription_user_checkout_idx").on(table.userId, table.checkoutRequestId),
}));

// One grant per paid transaction/installment. Unlike the legacy Creem schedule,
// a late or reordered renewal never replaces another paid year's remaining grants.
export const subscriptionCreditGrant = pgTable("subscription_credit_grant", {
  id: text("id").primaryKey(),
  subscriptionId: text("subscription_id").notNull().references(() => subscription.id, { onDelete: "cascade" }),
  paymentId: text("payment_id").notNull().references(() => payment.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  dueAt: timestamp("due_at").notNull(),
  grantedAt: timestamp("granted_at"),
}, table => ({ dueIdx: index("subscription_credit_grant_due_idx").on(table.dueAt) }));

// Credit ledger for auditability
export const creditLedger = pgTable("credit_ledger", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  delta: integer("delta").notNull(),
  reason: varchar("reason", { length: 64 }).notNull(), // 'subscription_cycle' | 'one_time_pack' | 'adjustment' | 'chat_usage' | ...
  paymentId: text("payment_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const subscriptionCreditSchedule = pgTable(
  "subscription_credit_schedule",
  {
    id: text("id").primaryKey(),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => subscription.id, { onDelete: "cascade" })
      .unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    planKey: varchar("plan_key", { length: 64 }).notNull(),
    creditsPerGrant: integer("credits_per_grant").notNull(),
    intervalMonths: integer("interval_months").notNull(),
    grantsRemaining: integer("grants_remaining").notNull(),
    totalCreditsRemaining: integer("total_credits_remaining").notNull(),
    nextGrantAt: timestamp("next_grant_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    nextGrantIdx: index("subscription_credit_schedule_next_grant_idx").on(table.nextGrantAt),
  }),
);

// Chat sessions
export const chatSession = pgTable("chat_session", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  title: text("title"),
  model: varchar("model", { length: 48 }).default("doubao-1-5-thinking-pro-250415").notNull(),
  totalMessages: integer("total_messages").default(0).notNull(),
  totalCreditsUsed: integer("total_credits_used").default(0).notNull(),
  lastMessageAt: timestamp("last_message_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
});

// Chat messages
export const chatMessage = pgTable("chat_message", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => chatSession.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 16 }).notNull(), // 'user' | 'assistant' | 'system'
  content: text("content").notNull(),
  creditsUsed: integer("credits_used").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Generation history for images and videos
export const generationHistory = pgTable("generation_history", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 16 }).notNull(), // 'image' | 'video'
  prompt: text("prompt").notNull(),
  imageUrl: text("image_url"), // For image-to-video generation
  resultUrl: text("result_url"), // Final result URL
  taskId: text("task_id"), // For async video generation tracking
  status: varchar("status", { length: 16 }).notNull().default("pending"), // pending, processing, completed, failed
  creditsUsed: integer("credits_used").default(0).notNull(),
  metadata: text("metadata"), // JSON string for additional data
  error: text("error"), // Error message if failed
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
});

// Password reset tokens
export const passwordResetToken = pgTable("password_reset_token", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Newsletter subscriptions
export const newsletterSubscription = pgTable("newsletter_subscription", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  status: varchar("status", { length: 16 }).notNull().default("active"), // active, unsubscribed
  unsubscribeToken: text("unsubscribe_token").notNull().unique(),
  subscribedAt: timestamp("subscribed_at").defaultNow().notNull(),
  unsubscribedAt: timestamp("unsubscribed_at"),
  updatedAt: timestamp("updated_at").defaultNow().$onUpdate(() => new Date()).notNull(),
});

// BOOTH sells video attempts independently of the starter's general AI credits.
export const rapAsset = pgTable("rap_asset", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  storageKey: text("storage_key"), width: integer("width").notNull(), height: integer("height").notNull(),
  expiresAt: timestamp("expires_at").notNull(), createdAt: timestamp("created_at").defaultNow().notNull(),
}, t => ({ expiry: index("rap_asset_expiry_idx").on(t.expiresAt) }));

export const rapOrder = pgTable("rap_order", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  requestId: text("request_id").notNull(), leftAssetId: text("left_asset_id").notNull().references(() => rapAsset.id),
  rightAssetId: text("right_asset_id").notNull().references(() => rapAsset.id),
  snapshot: text("snapshot").notNull(), amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull(), merchantId: text("merchant_id").notNull(), environment: text("environment").notNull(),
  providerOrderId: text("provider_order_id").unique(), approvalUrl: text("approval_url"),
  paymentId: text("payment_id").references(() => payment.id), status: text("status").default("created").notNull(),
  retryCredits: integer("retry_credits").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(), updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, t => ({ request: uniqueIndex("rap_order_user_request_idx").on(t.userId, t.requestId), user: index("rap_order_user_idx").on(t.userId, t.createdAt) }));

export const rapGeneration = pgTable("rap_generation", {
  id: text("id").primaryKey(), orderId: text("order_id").notNull().references(() => rapOrder.id),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  requestId: text("request_id").notNull(), leftAssetId: text("left_asset_id").notNull().references(() => rapAsset.id),
  rightAssetId: text("right_asset_id").notNull().references(() => rapAsset.id),
  snapshot: text("snapshot").notNull(), status: text("status").default("queued").notNull(),
  providerTaskId: text("provider_task_id").unique(), resultKey: text("result_key"),
  resultExpiresAt: timestamp("result_expires_at"), submittedAt: timestamp("submitted_at"), finishedAt: timestamp("finished_at"),
  nextRunAt: timestamp("next_run_at").defaultNow().notNull(), leaseUntil: timestamp("lease_until"),
  error: text("error"), providerCredits: text("provider_credits"),
  emailSentAt: timestamp("email_sent_at"), emailAttemptedAt: timestamp("email_attempted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(), updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, t => ({ request: uniqueIndex("rap_generation_user_request_idx").on(t.userId, t.requestId), work: index("rap_generation_work_idx").on(t.nextRunAt, t.status) }));

export const rapAudit = pgTable("rap_audit", {
  id: text("id").primaryKey(), orderId: text("order_id").notNull().references(() => rapOrder.id),
  generationId: text("generation_id").references(() => rapGeneration.id),
  kind: text("kind").notNull(), note: text("note"), createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const rapFeedback = pgTable("rap_feedback", {
  id: text("id").primaryKey(), orderId: text("order_id").notNull().references(() => rapOrder.id),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  request: text("request").notNull(), message: text("message").notNull(),
  status: text("status").default("open").notNull(), resolution: text("resolution"),
  emailSentAt: timestamp("email_sent_at"), createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, t => ({ userOrder: uniqueIndex("rap_feedback_user_order_idx").on(t.userId, t.orderId) }));

// Anonymous, coarse funnel events; never include photos, emails or raw URLs.
export const rapMetric = pgTable("rap_metric", {
  id: text("id").primaryKey(), sessionId: text("session_id").notNull(), event: text("event").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, t => ({ uniqueEvent: uniqueIndex("rap_metric_session_event_idx").on(t.sessionId, t.event) }));
