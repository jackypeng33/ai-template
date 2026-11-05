# BOOTH 内容审核代码修改方案

**Goal:** 上传照片通过审核后才能付款与生成，成品视频通过审核后才能交付。

**Architecture:** 独立 `rap_moderation` 持久化队列，复用现有 cron；SeeAPI 适配器负责请求和结果验证，业务层负责版本绑定、拦截和交付事务。首版采用服务端轮询。

**Tech Stack:** Next.js、TypeScript、Drizzle/PostgreSQL、S3 私有存储、SeeAPI、Vitest。

状态：代码修改设计，尚未实施。以 MVP SPEC 第 14 节为依据；本文不授权真实审核、视频生成、支付或数据库迁移。

## 1. 现有缺口

- `savePortrait()` 目前只规范化图片和保存私有文件，没有审核状态。
- `assertAssets()` 只校验归属、有效期和文件存在。
- `startRapCheckout()` 复用既有订单/approvalUrl 时绕过新素材检查。
- `worker.ts` 在 KIE 成功、文件转存后直接设置 succeeded，并启动结果期限。
- 媒体接口和完成邮件仅依赖生成成功状态，没有独立审核校验。
- 私有存储尚无供 SeeAPI 拉取文件的签名 URL 能力。

## 2. 数据模型与迁移

修改 `lib/db/schema.ts`；使用 `pnpm db:generate` 生成下一条 `drizzle/` 迁移及元数据，不手写已应用迁移。

- [ ] `rap_asset` 新增规范化文件 SHA-256、当前审核 ID；记录只对应不可变文件。换图创建新 asset。
- [ ] `rap_generation` 新增结果 SHA-256、当前审核 ID、结果暂存时间、隔离清理期限和审核通过时间；resultKey 可以指向隔离文件，存在 key 不代表可交付。
- [ ] 新增 `rap_moderation`：id、userId、assetId/generationId（二者恰有一个）、mediaHash、policyVersion、model、endpoint、status、providerTaskId、idempotencyKey、请求快照、脱敏判定摘要、错误码、attempts、nextRunAt、leaseUntil、时间戳。
- [ ] 审核状态：pending / submitting / processing / approved / rejected / error。error 保持不可用，通过 nextRunAt 和错误类型区分可重试与需人工介入。
- [ ] 唯一约束绑定媒体 ID、哈希、策略版本和审核轮次，避免并发重复建任务；供应商任务 ID、幂等键唯一。增加到期队列索引、归属和状态约束。
- [ ] 旧素材和旧成品不能自动回填 approved；对仍有效文件按批次计算哈希、排审核。未审核旧成品由媒体与邮件的独立门禁阻止交付。

审核记录为判定来源，业务表仅保存当前审核引用，避免维护两套互相矛盾的状态。订单继续绑定不可变资产，审核策略快照保存在关联记录中。

## 3. SeeAPI 适配器与审核策略

新增 `lib/rap/seeapi.ts`、`lib/rap/moderation-policy.ts`。

- [ ] 适配器提供提交图片、提交视频、查询审核三个方法；服务端密钥、请求超时、响应体大小上限、Zod 严格解析；禁止浏览器直连。
- [ ] 接口契约依据 SPEC 链接；实现时再次核对官方文档。图片与视频分别解析，不能将生成接口查询逻辑用于审核。
- [ ] 策略函数输出 approved / rejected / unresolved。执行成功不是审核通过；命中、策略拦截拒绝，报告缺失/矛盾/采样不完整进入 unresolved。
- [ ] 视频判定核对整体结果、逐帧结果、帧数与计数一致性；未知 schema 默认不可放行。
- [ ] 建议首轮模拟配置为视频 32 帧、threshold_offset=0、strict_special_care=true、return_frames=none；这只是待受控验证的策略，不宣称检测效果已经验证。策略参数改动生成新版本。
- [ ] 请求体在提交前持久化；同一请求重试复用原 body 和幂等键。提交超时不能立即新建不同任务；按供应商幂等契约恢复，无法确认则人工处理。
- [ ] 429/5xx 退避重试；鉴权、余额和无效请求暂停并显示运营错误。日志不输出密钥、签名 URL 或原始媒体。

## 4. 私有文件访问

修改 `lib/rap/storage.ts`、`package.json`、`pnpm-lock.yaml`；使用 pnpm 添加与现有 S3 SDK 兼容的 `@aws-sdk/s3-request-presigner`。

- [ ] 新增仅内部使用的签名 GET 方法，只接受系统已有存储键，不能签名用户提供的任意 URL。
- [ ] 签名期限覆盖预计审核处理窗口，请求快照中签名 URL 作为敏感字段保存并限制读取。
- [ ] URL 过期不在原幂等键下替换请求体；先确认原任务终态，再以新审核轮次与新幂等键提交。旧轮次的晚到结果不能覆盖当前轮次。
- [ ] 本地 `.data/rap-private` 无法供 SeeAPI 拉取，开发用 mock；受控联调使用私有桶。审核不可用时不退回公开文件。
- [ ] 对视频校验真实容器、时长和大小，现有转存允许 150 MB，须与审核供应商限制统一；不符合限制时转人工处理，不绕过审核。

## 5. 上传与付款门禁

修改 `lib/rap/repository.ts`、`lib/rap/payments.ts`、`app/api/rap/assets/route.ts`；新增 `app/api/rap/assets/[id]/route.ts`。

- [ ] `savePortrait()` 对最终规范化字节计算哈希，私有文件保存后在同一事务写 asset 与审核任务。事务失败补偿删除文件，保留孤儿文件清理机制。
- [ ] 上传返回 assetId 与 pending 状态；新增 GET 仅返回当前用户素材的脱敏审核状态，不返回供应商签名地址。
- [ ] 将 `assertAssets()` 扩展为要求有效的、与哈希及允许策略匹配的 approved 审核；待审、拒绝和异常使用不同错误码。
- [ ] `startRapCheckout()` 对新订单以及复用未付款订单、旧 approvalUrl 的路径均检查素材；重复已付款请求仍按原幂等语义返回已有订单。
- [ ] `completeRapPayment()` 在主动 capture 前校验审核。远端已 COMPLETED 时仍调用原结算逻辑，原子记录付款和初始任务；审核异常只能阻止履约，不能丢账或拒收真实付款事实。
- [ ] `retryRapGeneration()` 在消费补发机会前检查审核；未通过不得扣补发次数。
- [ ] Worker 在上传素材到 KIE 前再次检查，未通过转入等待审核/人工处理，不调用生成接口，也不调用自动技术失败补偿。

## 6. 审核队列与视频交付

新增 `lib/rap/moderation-worker.ts`、`lib/rap/moderation-repository.ts`；修改 `lib/rap/worker.ts` 和 `app/api/cron/rap-video/route.ts`。

- [ ] 使用短事务 + SKIP LOCKED + lease 领取审核任务；外部请求在事务外完成，回写携带租约条件，过期 worker 不得覆盖新结果。
- [ ] cron 单独执行限量审核工作，设总时间预算，避免生成任务占满预算后照片审核一直得不到执行；浏览器查询只读状态，不承担队列执行。
- [ ] KIE 成功后只转存一次、计算哈希，事务写入待审核结果及唯一审核任务，生成状态转为 moderating。审核重试不能重复下载覆盖同一成品或重新生成。
- [ ] 审核通过后按订单 → 生成任务 → 审核记录顺序锁定，重新核对支付状态、当前审核 ID、文件哈希和文件存在性。退款/争议订单不得被晚到审核恢复为可交付。
- [ ] 首次有效通过才写 succeeded、approvedAt、resultExpiresAt=可交付时刻+7天、finishedAt 和唯一 video_ready 审计；重复处理不能延长期限。
- [ ] 拒绝写 content_rejected，保持不可交付并转人工流程，绝不调用 `failRapGeneration()`。审核异常继续 moderating 并展示审核错误/人工核查提示。
- [ ] 更新 activeStatuses、worker 领取条件、失败终态保护、退款冻结和清理条件。moderating 不应被生成 worker 当作需要重新查询/生成的任务；content_rejected 是生成终态，可由独立客服流程处理权益。

## 7. 媒体、邮件、后台和清理

修改 `app/api/rap/generations/[id]/media/route.ts`、`lib/rap/worker.ts`、`app/api/rap/manage/route.ts`、`features/rap/rap-manager.tsx`。

- [ ] 媒体接口和邮件发送前均核对当前成品审核 approved、哈希一致、订单有效、结果未过期；不要仅检查 succeeded。
- [ ] 后台显示审核阶段、任务 ID、脱敏原因和重试次数；允许管理员重试异常审核，不能直接把 rejected 改为 approved。
- [ ] 成品拒绝后沿用现有反馈和人工补发/退款记录，新增审核拒绝审计；不自动补发、不自动退款、不改变通用积分。
- [ ] 建议拒绝媒体 24 小时内清理，审核异常媒体最长保留 7 天；正常草稿沿用 24 小时。该清理策略在实现时同步 SPEC 与隐私条款。
- [ ] 清理涵盖尚无 resultExpiresAt 的隔离结果，删除前防并发交付；被删除文件不能被晚到审核恢复。共享输入清理识别 moderating 活跃任务。

## 8. 前端与配置

修改 `features/rap/rap-landing.tsx`、`features/rap/draft.ts`、`features/rap/rap.module.css`、订单列表/详情 API、`lib/rap/config.ts`、`.env.example` 和 `app/[locale]/rap/policy/page.tsx`。

- [ ] 保留先选图再登录：登录后上传，展示 Checking photos；查询审核状态，两张通过后允许继续 PayPal，拒绝定位到对应照片并要求替换。
- [ ] 草稿保存 assetId；恢复时向服务端重查，不能相信 IndexedDB 中的 approved。换图清空对应旧 ID，取消旧轮询并防止晚到响应覆盖新图。
- [ ] 视频区展示 Checking your video / Content not approved / Review delayed；审核未通过不渲染播放器或下载链接。只返回脱敏原因，不返回供应商敏感报告。
- [ ] 新增服务端 `SEEAPI_API_KEY`、默认 false 的 `RAP_MODERATION_ENABLED`；策略集中定义并版本化。checkout readiness 加入审核配置与私有存储条件。
- [ ] 新审核开关仅允许执行审核，不能授权视频生成；原四个开关仍默认 OFF。缺少审核能力不能放行收费或生成。
- [ ] `/rap` 按独立英语产品要求更新提示、FAQ 和隐私说明，列出 SeeAPI 处理照片与视频的用途。

## 9. 验证顺序

按数据层 → 适配器 → 上传门禁 → 审核 worker → 交付门禁 → UI 的顺序实施，每一步先补对应失败用例，再实现并运行相关测试。

新增测试文件：

- `tests/lib/rap-moderation.test.ts`：正常通过、flagged、policy block、缺失/矛盾/不完整报告、未知 schema、网络异常、关闭开关零调用。
- `tests/lib/rap-moderation-worker.test.ts`：提交响应丢失、原 body 重试、签名过期、新旧轮次、租约过期、审核重试不触发生成。
- `tests/lib/rap-moderation.integration.test.ts`：唯一队列、并发回写、退款与审核同时到达、迟到结果、不可延长到期、拒绝不发补偿、付款原子入账。

扩展现有测试：

- `tests/lib/rap-routes.test.ts`：未审素材不能建订单，旧 approvalUrl 复用拦截，跨用户素材不可查询，未审/拒绝视频不能下载。
- `tests/lib/rap-settlement.integration.test.ts`：已扣款但审核不通过仍只入账一次，补发前审核失败不扣机会。
- `tests/components/rap-landing.test.tsx`：登录恢复、待审禁用付款、换图不复用判定、审核拒绝不渲染成品。

执行 `pnpm lint`、`pnpm test`、`pnpm build`。数据库用例仅在专用 `RAP_TEST_DATABASE_URL` 下执行，未配置则明确标记未运行；真实供应商调用全用 mock。测试与迁移验证后才安排另行授权的受控联调。

## 10. 上线顺序

先部署兼容迁移和始终拒绝未审内容的交付门禁，保持收费/生成关闭；部署完整队列与前端；处理有效旧数据；在受控联调验证阈值、成本、恢复、清理和客服规则后再评估开启审核及业务开关。回滚应用不能回滚到可绕过审核的交付逻辑。
