# BOOTH 外部服务配置与部署手册

更新：2026-11-06。按当前仓库 `a0d603d` 的行为编写；文档变更本身不会配置外部服务或授权付费调用。

商品基线：`/rap`，英语界面，双人照片，10 秒 / 720p / 9:16，$5.99 USD 单次 PayPal 购买。

阅读顺序：[Neon 数据库切换](./rap-neon.md) → 本文 → [R2 详细说明](./rap-r2.md) → [MVP 流程与执行逻辑](../RAPVIDEO-MVP-FLOW.md)。需求以 [MVP SPEC](../RAPVIDEO-MVP-SPEC.md) 为准。

## 1. 本地、预发布、生产分别配置

1. 安装项目声明的 Node/pnpm 环境，运行 `pnpm install`。
2. 本地创建未提交的 `.env.local`，参考 `.env.example`，不要把占位密钥当成实际值。
3. Vercel 在 Project → Settings → Environment Variables 按 Development / Preview / Production 配置，修改后重新部署。
4. 数据库、私有桶、Token、支付环境按环境隔离；预览环境不要启用生产客户任务的 cron。
5. 当前仓库没有 `vercel.json` 定时任务配置。代码声明一个路由并不代表平台已安排执行。

最先保留以下关闭状态：

```dotenv
RAP_VIDEO_GENERATION_ENABLED="false"
RAP_CHECKOUT_ENABLED="false"
RAP_QUALITY_APPROVED="false"
RAP_MUSIC_RIGHTS_APPROVED="false"
RAP_MODERATION_ENABLED="false"
PAYPAL_ENABLED="false"
PAYPAL_SUBSCRIPTIONS_ENABLED="false"
```

这些开关的默认值是代码/示例要求，不表示运营环境一定正确，需逐环境核对。真实生成仍受用户此前“暂不调用视频 API”的指令约束。

## 2. 配置清单与验证入口

| 服务 | 变量 | 配置位置/用途 | 验证 |
| --- | --- | --- | --- |
| PostgreSQL/Neon | `DATABASE_URL` | 本地 `.env.local` / Vercel；应用数据库 | 登录、只读查表，见 Neon 手册 |
| Better Auth | `BETTER_AUTH_SECRET`、`BETTER_AUTH_URL`、`BETTER_AUTH_TRUSTED_ORIGINS` | 会话、认证地址与受信任来源 | 注册/登录、退出、恢复草稿 |
| 应用域名 | `NEXT_PUBLIC_APP_URL` | 前端可见基础地址，也是 Rap Origin 校验依据 | 回跳、邮件链接与当前域名一致 |
| 私有 R2 | `RAP_STORAGE_BUCKET`、`STORAGE_ENDPOINT`、`STORAGE_REGION`、`STORAGE_ACCESS_KEY_ID`、`STORAGE_SECRET_ACCESS_KEY` | 上传、审核临时签名、成品保存 | 私有桶、直传确认、越权测试 |
| SeeAPI | `SEEAPI_API_KEY`、`RAP_MODERATION_ENABLED` | 图片与视频审核 | 先 mock，再单独授权的受控审核 |
| KIE | `KIE_API_KEY`、`RAP_VIDEO_GENERATION_ENABLED` | 固定视频模型提交与查询 | 关闭时零调用；真实验证另行授权 |
| PayPal | `PAYPAL_ENABLED`、`PAYPAL_ENV`、`PAYPAL_CLIENT_ID`、`PAYPAL_CLIENT_SECRET`、`PAYPAL_MERCHANT_ID`、`PAYPAL_WEBHOOK_ID` | 共用 PayPal 客户端 | 完整 sandbox 凭证与订单核对 |
| Rap 支付回调 | `RAP_PAYPAL_WEBHOOK_ID` | `/api/rap/paypal/webhook` 独立验签 | 重复通知仅结算一次 |
| Resend | `RESEND_API_KEY`、`RESEND_FROM_EMAIL` | 结果、客服及认证相关邮件 | 受控收件箱检查实际送达 |
| 客服 | `RAP_SUPPORT_EMAIL` | 接收关联订单反馈 | 客服能收到、能回复 |
| 调度器 | `CRON_SECRET` | 保护 Rap cron | 无凭证 401、合法调度有运行记录 |
| 专用测试数据库 | `RAP_TEST_DATABASE_URL` | PG 集成测试；不作应用连接 | 必须使用非生产专用空库 |

所有密钥仅服务端配置。`NEXT_PUBLIC_APP_URL` 是公开 URL；不要给数据库密码、存储密钥、cron 密钥或供应商密钥加 `NEXT_PUBLIC_`。

## 3. 数据库

按 [Neon 操作手册](./rap-neon.md) 区分空库建表与旧库数据迁移。当前应用和迁移都读取 `DATABASE_URL`；迁移进程临时覆盖 direct 地址，或者先实施文档中的可选双变量配置改造。

新环境需应用仓库完整迁移；数据库迁移不是 `pnpm build` 的自动步骤。迁移前先核对目标库，不把 `db:push` 当作有数据生产库的常规升级路径。

数据库切换不复制 R2 对象，也不替你注册 webhook、发送邮件或调度任务。

## 4. 域名与登录

本地示例：

```dotenv
NEXT_PUBLIC_APP_URL="http://localhost:3000"
BETTER_AUTH_URL="http://localhost:3000"
BETTER_AUTH_TRUSTED_ORIGINS="http://localhost:3000"
```

生产示例：

```dotenv
NEXT_PUBLIC_APP_URL="https://booth.example.com"
BETTER_AUTH_URL="https://booth.example.com"
BETTER_AUTH_TRUSTED_ORIGINS="https://booth.example.com"
```

`BETTER_AUTH_SECRET` 使用稳定的随机密钥，可在本地执行 `openssl rand -base64 32` 生成后安全保存。数据库迁移时保留已有 secret；主动轮换会影响会话验证，应另行安排。

`lib/auth.ts` 的受信任来源默认只有 localhost，因此生产不能只改一个 URL；应显式配置允许的来源。Rap 写接口的 Origin 校验使用 `NEXT_PUBLIC_APP_URL`，应与实际前端匹配，不因 Better Auth 允许多个来源就假定 Rap 全部允许。

Google OAuth 为可选：只有 `AUTH_GOOGLE_ID` 和 `AUTH_GOOGLE_SECRET` 同时存在才启用。不需要 Google 时将示例占位值留空。邮件密码登录可以独立使用。

## 5. R2 私有存储

详见 [rap-r2.md](./rap-r2.md)，操作顺序：

1. 新建环境专用私有桶，关闭公开访问/r2.dev，不绑定公开客户媒体域名。
2. 创建限该桶的 Object Read & Write API Token。
3. 配置 `RAP_STORAGE_BUCKET` 和现有 `STORAGE_*`，region 使用 `auto`。
4. CORS 只允许实际前端 Origin 的 PUT 和 Content-Type。
5. 仅对 `temp/` 设置 1 天生命周期；`rap/` 由应用按业务到期清理。
6. 验证浏览器 PUT、确认接口真实图片校验，以及 B 用户无法访问 A 用户记录。

代码优先级：`RAP_STORAGE_BUCKET` 优先于 `R2_BUCKET_NAME`；对应 `STORAGE_*` 优先于 `R2_*` 别名。不要同时保留旧变量占位值再填写新别名，否则占位值可能抢先被读取。Rap 不回退到 `STORAGE_BUCKET_NAME`，也不使用 `R2_PUBLIC_URL`/`STORAGE_PUBLIC_URL` 交付客户媒体。

签名 URL 使用 R2 S3 API 域名，不替换成 CDN 域名；浏览器直传需要桶 CORS。[Cloudflare 官方说明](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)

## 6. SeeAPI 内容审核

1. 在 SeeAPI 账号准备仅服务端使用的 API Key，并核对模型权限和余额。
2. 配置 `SEEAPI_API_KEY`，先保持 `RAP_MODERATION_ENABLED=false`。
3. 确认私有 R2 和 cron 已配置；本地私有目录不能供 SeeAPI 读取。
4. mock 测试通过后，再经单独授权，在隔离环境启用审核做受控联调。
5. 验证通过、拒绝、超时、空报告、不完整采样、签名过期和重试；不可把任务执行成功当作内容通过。

当前实现：图片 `nsfw-filter/image-moderation`，视频 `video-nsfw-filter/video-moderation`；视频 32 帧，严格模式，threshold_offset=0，不请求返回帧图片。模型参数在 `lib/rap/seeapi.ts`，策略版本在 `lib/rap/moderation-policy.ts`，不是环境变量。

创建与查询均走 `/v1/inferences`，服务端轮询，无需为当前实现注册 SeeAPI 回调。审核会产生外部费用，打开审核开关不是纯本地测试。审核通过仍不代表绝对无风险，也不覆盖音乐版权或音频内容。

参考：[图片契约](https://www.seeapi.com/docs/nsfw-filter/image-moderation/)、[视频契约](https://www.seeapi.com/docs/video-nsfw-filter/video-moderation/)。

## 7. KIE 视频生成与模板

配置 `KIE_API_KEY` 后仍保持生成开关关闭。当前固定模型、提示词与规格在 `lib/rap/config.ts`；音轨在 `public/rap/booth-original-v2.wav`，模板为 `orange-booth-en-v2`。

上线评估依次需要：音乐权利确认、最终模板与 5 组素材质量/成本验证、审核与支付联调、预算及真实调用授权。只有验证完成才由负责人据实设置质量/音乐开关，不能为了让按钮可用先把它们置 true。

旧订单保留旧 snapshot；当前 `verifiedRapMusic()` 对比当前模板、提示词和音轨哈希，旧版本不匹配时转 `TEMPLATE_REQUIRES_REVIEW`，不会自动使用新模板履约。

## 8. PayPal 沙箱、正式环境和两个 Webhook ID

1. 在 PayPal Developer 创建/选择 REST 应用，先使用 sandbox，准备买家测试账号和商家账号。
2. 填写匹配环境的 Client ID、Client Secret、Merchant ID；`PAYPAL_ENV="sandbox"`。
3. 为 Rap 独立 HTTPS 地址注册 Webhook：

```text
https://booth.example.com/api/rap/paypal/webhook
```

订阅事件：

```text
CHECKOUT.ORDER.APPROVED
PAYMENT.CAPTURE.COMPLETED
PAYMENT.CAPTURE.REFUNDED
PAYMENT.CAPTURE.REVERSED
```

4. 将该注册记录的 ID 填入 `RAP_PAYPAL_WEBHOOK_ID`，不要填成通用入口的 ID。
5. 当前 `getPayPalConfig()` 还强制要求非空 `PAYPAL_WEBHOOK_ID`：这是共用客户端的现有依赖。需要按通用支付入口 `/api/payments/paypal/webhook` 的独立注册配置其 ID。不能把 Rap ID 冒充另一个 URL 的 ID，也不要填写虚构值绕过检查；若只想部署 Rap 而不注册通用入口，需另做客户端配置解耦代码变更。
6. 凭证完整后可在隔离沙箱环境设置 `PAYPAL_ENABLED=true`；这只启用客户端，不等于 Rap 收费已开放。前端还受第 11 节的其他门槛限制。
7. 受控验证批准、capture、返回页同步、webhook 重发、金额和商户校验、取消、退款通知；本地 localhost 无法直接接收 PayPal HTTPS 回调，使用受控 HTTPS 预发布环境。
8. 正式环境重新准备 live 应用凭证、商户和各自 webhook ID；不能只改 `PAYPAL_ENV` 继续用沙箱密钥。

Rap 是单次视频购买，不需要打开订阅或填写 `PAYPAL_PLAN_*`。实际结算验证不能由 webhook 模拟器的一次通知代替。[PayPal 官方 Webhook 说明](https://developer.paypal.com/api/rest/webhooks/rest/)

## 9. Resend 与客服

1. 在 Resend 添加自己拥有的发送域名，按面板提示配置 DNS，等待验证。
2. 创建受限用途的 API Key，填 `RESEND_API_KEY`。
3. 填 `RESEND_FROM_EMAIL="BOOTH <noreply@your-domain.com>"`，与已验证域名匹配。
4. 填可实际接收邮件的 `RAP_SUPPORT_EMAIL`，确认有人处理订单反馈。
5. 用隔离环境和受控收件箱测试认证邮件、完成邮件、反馈邮件；检查邮件链接指向正确域名。

代码优先使用 `RESEND_FROM_EMAIL`，避免依赖开发回退地址。完成邮件只有视频审核通过且订单有效时发送，失败可重试；发送成功不证明收件人已阅读，极端情况下可能重复。域名验证步骤参见 [Resend 官方说明](https://resend.com/docs/dashboard/domains/introduction)。

## 10. cron 调度

目标：外部调度器每分钟发起以下请求，密钥从平台 Secret 配置读取：

```text
GET https://booth.example.com/api/cron/rap-video
Authorization: Bearer <CRON_SECRET>
```

Rap 路由只实现 Bearer 校验；`.env.example` 的 `CRON_JOBS_USERNAME/PASSWORD` 不用于此接口。不要把密钥放在 URL 查询参数里。

当前没有自动安装调度的代码。如选 Vercel Cron，可在确认套餐频率、运行时长和部署保护条件后，另行添加以下示例配置并部署；它不是仓库已经存在的配置：

```json
{
  "crons": [
    { "path": "/api/cron/rap-video", "schedule": "* * * * *" }
  ]
}
```

为项目设置 `CRON_SECRET`，并按平台支持方式保护调用。平台限额与自动鉴权行为应以 [Vercel 官方说明](https://vercel.com/docs/cron-jobs/manage-cron-jobs) 为准；不支持一分钟频率时选择满足需求的托管调度器。

代码声明 `maxDuration=300`，部署平台必须实际允许；批次为审核 2 条、生成 1 条，后续支付补查和邮件受时间预算控制。返回 200 不等于每一项任务成功，应检查数据库状态、错误码和下一次处理时间。不要每次人工点击就多建一次供应商任务。

## 11. 业务开关及开启顺序

| 开关 | 含义 |
| --- | --- |
| `RAP_MODERATION_ENABLED` | 允许后台真实请求 SeeAPI；不授权生成 |
| `RAP_VIDEO_GENERATION_ENABLED` | 允许 KIE 上传、创建和查询；不单独开放收费 |
| `RAP_CHECKOUT_ENABLED` | 开放 Rap checkout 的一个条件 |
| `RAP_QUALITY_APPROVED` | 运营已完成质量验证的人工声明 |
| `RAP_MUSIC_RIGHTS_APPROVED` | 运营已确认音乐使用范围的人工声明 |
| `PAYPAL_ENABLED` | 共用 PayPal 客户端可配置 |

`GET /api/rap/config` 返回前端的 `checkoutAvailable`。代码要求生成、审核、收费、质量和音乐开关，以及 SeeAPI、R2、KIE、cron、Resend、客服、Rap webhook 配置；另外 `isPayPalEnabled()` 校验完整 PayPal 配置。变量非空不证明真实服务已连通，质量开关也不会自动执行质量验证。

建议执行顺序：

1. 完成配置与 mock 验证，保持所有真实业务开关关闭。
2. 隔离环境验证 Neon、R2、登录及 cron 鉴权。
3. 单独授权后受控验证审核、支付、生成与质量，记录成本及结果。
4. 补齐音乐证明、隐私条款、主体与客服信息。
5. 负责人据实确认各门槛，最后开放 checkout；上线后跟踪失败、待审、未知提交、补发与退款核查。

暂停新购买不等于停止履约；关闭生成会停止 KIE 查询，关闭审核会停止审核推进。已有付费任务在关闭前需要逐单安排后续处理。

## 12. 部署验收与排障

```bash
pnpm lint
pnpm test
pnpm build
```

数据库迁移独立执行，不能仅以 build 成功认定表已齐全。无专用 PG URL 时集成测试会跳过，应记录未验证项。

| 问题 | 优先检查 |
| --- | --- |
| checkoutAvailable=false | 五个 Rap 开关、全部依赖、PayPal 共用配置，不只检查按钮 |
| 浏览器 PUT 失败 | R2 CORS、前端 Origin、签名有效期、Content-Type |
| 上传后一直审核中 | cron 是否真实运行、SeeAPI 开关/权限/余额、审核错误与租约 |
| 生成一直 queued | 生成开关、审核开关、KIE Key、订单 paid、照片审核和 cron |
| submission_unknown | 去供应商核查原提交，不自动再创建生成 |
| TEMPLATE_REQUIRES_REVIEW | 订单 snapshot 与当前模板/音轨版本差异 |
| webhook 401 | URL 对应的专用 ID、环境和签名头 |
| 视频拒绝/异常 | 不交付，查看审核记录并走人工处理；不当作技术失败自动补偿 |
| 视频 410 | 状态、Key、期限；数据库清理不保证供应商副本一并删除 |
| 邮件没有收到 | API Key、已验证发件域名、发送日志、emailSentAt 与实际收件箱 |

本手册未承诺 Neon、R2、PayPal、SeeAPI、KIE 或 Resend 已完成真实联调，也未替你开启任何服务。
