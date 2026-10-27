# BOOTH MVP 开发与交接

日期：2026-10-27。需求：[MVP SPEC](./RAPVIDEO-MVP-SPEC.md)。用户已授权开发，并要求暂不调用视频生成 API。

## 交付范围

- `/rap`：英语手机优先独立落地页、两张照片与角色预览、样例照片、8 秒音乐试听、登录/注册、按次购买、我的视频、补发与反馈入口。
- `/rap/policy`：本产品条款、隐私及退款规则；正式经营主体等上线信息仍需补齐。
- `/rap/manage`：仅管理员查看订单、异常任务、漏斗计数及客服请求，记录人工补发或已在 PayPal 完成的退款。
- 8 秒/720p/9:16，左主唱右配合，固定模板与音轨，单次 $5.99 USD。
- 复用 Better Auth、PayPal REST/验签、Resend、S3 SDK、Drizzle；视频购买不变更通用积分余额。

## 本地运行

使用现有项目的 Node/pnpm 环境，配置开发 PostgreSQL 后：

```powershell
pnpm install
pnpm db:migrate
pnpm dev:webpack
```

访问 `http://localhost:3000/rap`。数据库迁移会修改目标数据库，务必核对自己的 `DATABASE_URL`。本次代理仅在独立本地测试库运行迁移，不迁移你的业务库。

新增 `0012_rap_video_mvp.sql`、`0013_rap_funnel.sql` 及 Drizzle 快照。客户照片保存在私有存储；开发时可降级 `.data/rap-private`，生产必须使用 `RAP_STORAGE_BUCKET` 私有桶及现有 `STORAGE_*` 凭证。客户文件不进入 `public/`；其中样例照片是用户提供素材的明确副本。

## 开关与外部服务

默认保持：

```dotenv
RAP_VIDEO_GENERATION_ENABLED=false
RAP_CHECKOUT_ENABLED=false
RAP_QUALITY_APPROVED=false
RAP_MUSIC_RIGHTS_APPROVED=false
```

`KIE_API_KEY` 存在也不会自动启用。KIE 上传、提交与查询均受生成开关保护，收费另受四个开关、PayPal、邮件、cron、客服和私有存储配置约束。当前预览可以选照片、听音乐、登录；不能支付购买不可交付的视频。

PayPal：复用 `PAYPAL_*` 凭证与环境、商户 ID。为 `/api/rap/paypal/webhook` 单独注册 Webhook，将其 ID 写入 `RAP_PAYPAL_WEBHOOK_ID`，订阅 CHECKOUT.ORDER.APPROVED、PAYMENT.CAPTURE.COMPLETED、PAYMENT.CAPTURE.REFUNDED、PAYMENT.CAPTURE.REVERSED。模板原有支付使用原入口与 `PAYPAL_WEBHOOK_ID`，两个入口不可混用 ID。缺少 Rap 专用 ID 时拒绝通知并关闭收费。

邮件：`RESEND_API_KEY`、有效发件地址及 `RAP_SUPPORT_EMAIL`。客服邮件包含订单和用户回复地址。任务完成邮件可重试，极端情况下可能重复发送，但不会重复生成或发权益。

后台处理：平台外部调度器每分钟调用一次 `GET /api/cron/rap-video`，携带 `Authorization: Bearer <CRON_SECRET>`。该路由短批次处理，数据库任务记录是持久化队列；浏览器关闭后仍可继续。部署平台需允许对应最大运行时间；负载增大时迁出独立 Worker。不要使用未托管的响应后 Promise 或浏览器轮询代替任务执行。

## 核心代码

| 位置 | 职责 |
| --- | --- |
| `features/rap/*` | 落地页、IndexedDB 草稿、客服运营页面 |
| `lib/rap/config.ts` | 固定商品、价格、提示词、生成与收费开关 |
| `lib/rap/repository.ts` | 真实图片解码规范化、原子支付履约、失败返还与重试 |
| `lib/rap/payments.ts` | 订单快照、PayPal 绑定/捕获/通知 |
| `lib/rap/snapshot.ts` | 固定音轨哈希，防止已付款素材被静默替换 |
| `lib/rap/kie.ts` | 固定供应商契约、关闭开关时零外部调用 |
| `lib/rap/worker.ts` | 提交租约、状态查询、私有结果转存、邮件、清理 |
| `lib/rap/storage.ts` | 私有桶与开发文件存储 |
| `app/api/rap/*` | 鉴权、归属、接口与管理操作 |
| `lib/db/schema.ts` | rap_asset/order/generation/audit/feedback/metric |

## 一致性与恢复

1. 服务端核对金额、币种、商户、环境、本地引用及完整 capture，事务中锁订单，写支付和初始任务并标记已付款。结果不能由前端返回参数决定。
2. 每个用户请求 ID 唯一；支付重复通知只产生一个初始任务。网站积分保持原样。
3. 每次技术失败只记一条补发审计；订单锁保证重复失败、重复使用补发不会多发权益或多建任务。
4. 提交前写 `submitting`。提交响应丢失、任务 ID 未知时进入 `submission_unknown`，不自动再次创建。管理员需在 KIE 核查原始请求；没有证据不能补填假 task ID。首版未提供自动查询未知提交的能力。
5. 已有 task ID 只查询同一任务。成功但解析/转存失败继续恢复原结果，不重新生成。
6. 退款/撤销通知进入人工核查并冻结已关联订单；未能关联的事件保留 `requires_review`，运营需核对，不能假定已自动处理所有争议。
7. 结果只从已保存私有文件提供，强制账号归属与期限；不向用户暴露短期供应商地址。首次下载请求写审计，但不能证明传输完成、本地保存或实际社交分享；首轮目标中的真实下载需结合用户反馈核实。
8. 手工退款先在 PayPal 执行，再在运营页填写退款 ID。服务端查验完整退款、金额和 capture 关联后记录。该入口不自动执行退款。首版不支持自动部分退款。

## 素材

见 [素材来源与生成提示词](../public/rap/ASSETS.md)。已生成静态概念海报、8 秒原创节拍、英语合成参考人声和纯伴奏。没有调用 KIE 视频接口，也没有生成、上传或冒充真实模型结果。音轨可在网页直接试听。

## 验证与未完成的外部联调

测试覆盖无视频调用开关、固定参数、媒体校验、价格篡改、归属、原子履约回滚、并发通知、一次返还、并发重试、未知提交恢复及预览 UI。隔离 PG 测试只使用 `RAP_TEST_DATABASE_URL`，不使用业务 `DATABASE_URL`。

上线前仍需：确认最终音乐与人声使用权；5 组真实生成及成本质量验证；配置商户和 Webhook；PayPal 沙箱及受控真实支付；生产私有桶、邮件、cron；运营联系信息与法律文本；根据实际流量调整阈值与容量。当前未声称这些已完成。
