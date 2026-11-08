# BOOTH 数据库切换到 Neon 操作手册

更新：2026-11-06。适用于当前 PostgreSQL + postgres.js + Drizzle 实现。本文是操作说明，没有替你创建 Neon 项目、修改环境变量或执行迁移。

关联：[配置与部署](./rap-configuration.md) · [MVP 执行逻辑](../RAPVIDEO-MVP-FLOW.md) · [开发交接](../RAPVIDEO-MVP-IMPLEMENTATION.md)。

## 1. 当前配置入口

| 文件/目录 | 当前行为 |
| --- | --- |
| `.env.local` | 本地实际配置，不提交 Git；Next.js 开发服务会读取 |
| `.env.example` | 变量示例，不能把示例口令直接投入运行 |
| `lib/db/index.ts` | 读取 `DATABASE_URL`，通过 `postgres(..., { prepare: false })` 连接，再交给 Drizzle |
| `drizzle.config.ts` | 显式加载 `.env.local`，迁移目前只读取 `DATABASE_URL` |
| `lib/db/schema.ts` | 完整应用表结构，包含 auth、payment、通用积分与 `rap_*` |
| `drizzle/*.sql` 和 `drizzle/meta/` | SQL 迁移、快照与迁移目录索引；不是实际数据库应用历史 |
| `scripts/setup-admin.ts` | 加载 `.env.local`，使用 `DATABASE_URL` 初始化已有用户的管理员权限 |

应用已使用标准 PostgreSQL 驱动，切换 Neon 不要求改成 HTTP 驱动。Rap 的交互式事务、行锁及事务级 advisory lock 应继续保留。

## 2. Neon 创建与连接串

1. 在 Neon 控制台创建项目，选择接近应用部署区域的可用区域。
2. 区分开发、预发布与生产；测试使用专用空数据库，不复制客户数据作为测试样本。
3. 在目标项目/分支的 Connect 面板选择正确数据库和角色。
4. 分别复制 pooled 和 direct 连接串，保留面板给出的 SSL/其他连接参数。
5. pooled 地址一般包含 `-pooler`，用于应用运行；direct 地址用于迁移、导入导出。

示例仅为占位：

```dotenv
DATABASE_URL="postgresql://USER:PASSWORD@ep-example-pooler.REGION.aws.neon.tech/neondb?sslmode=require"
```

复制到根目录 `.env.local`。Vercel 则在项目环境变量中按环境配置同名变量，修改后重新部署。不要把连接串输出到日志或提交到仓库。

官方依据：[Neon 与 Drizzle](https://neon.com/docs/guides/drizzle)、[连接池](https://neon.com/docs/connect/connection-pooling)。

## 3. 运行连接与迁移连接：当前可执行方式

**当前 `drizzle.config.ts` 尚不读取 `DATABASE_URL_UNPOOLED`。只新增这个变量不会改变迁移目标。**

无需改代码的做法：应用 `.env.local` 保持 pooled 地址；执行迁移时只给该进程覆盖 `DATABASE_URL` 为 direct 地址。下列命令适用于本项目的 zsh，连接串从交互输入读取：

```zsh
read -rs 'NEON_DIRECT_URL?Paste Neon direct URL: '
printf '\n'
DATABASE_URL="$NEON_DIRECT_URL" pnpm db:migrate
unset NEON_DIRECT_URL
```

`dotenv.config()` 默认不覆盖已经导出的进程变量，因此该命令使用你输入的 direct 地址，不会改写 `.env.local`。父 shell 如果本来导出了 `DATABASE_URL`，应用启动时也可能优先读取它，排查时不要只看文件。

可选的长期配置改造（仅为示例，本次未修改代码）：

```ts
// drizzle.config.ts 的 dbCredentials
url: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL!,
```

完成这个代码改造后，才可以在本地/迁移环境分别填写 `DATABASE_URL`（pooled）和 `DATABASE_URL_UNPOOLED`（direct），直接运行 `pnpm db:migrate`。

## 4. 场景 A：全新的空数据库

1. 确认 Neon 目标库为空、角色有建表权限，连接串不是旧生产库。
2. 本地运行 `pnpm install`，确认当前仓库的迁移文件完整。
3. 按第 3 节通过 direct 地址运行 `pnpm db:migrate`。
4. 回到 pooled `DATABASE_URL` 启动 `pnpm dev:webpack`。
5. 打开 `/`，注册或登录；新库不会自动拥有旧库用户。
6. 如需管理员，先创建该账号，再在正确环境运行：

```zsh
ADMIN_EMAIL="admin@example.com" pnpm admin:setup
```

该脚本会修改用户权限，邮箱应替换为实际管理账号。不要为了测试登录而启用视频生成或收费。

`db:migrate` 创建完整应用表，不只创建 Rap 表。仅更换数据库不需要 `db:generate`；后者只在 schema 变化时生成 SQL。正式环境优先使用版本化迁移，不以 `db:push` 代替迁移历史。

## 5. 场景 B：保留原有用户、订单与任务

适用于已有业务数据的数据库切换。不能只创建空表再改连接串。

### 5.1 切换准备

- 先在隔离环境演练导入，核对 PostgreSQL 版本、扩展和数据库角色权限。
- 记录源库、目标库、当前应用版本、迁移历史、各关键表行数及尚在处理的订单/任务。
- 保留现有 `BETTER_AUTH_SECRET` 等业务配置；只换数据库不应顺便轮换认证和支付密钥。
- R2 文件不包含在数据库备份中。沿用原桶和凭证，或另做对象复制并核对每条 Object Key。
- 正式窗口暂停新业务写入和 cron，停止旧应用写入；妥善暂停/记录支付通知并安排切换后的重放或补查。仅关闭购买按钮不能阻止 webhook、登录注册或后台写入。
- 确保旧部署不会与新部署同时处理同一批订单。不要给预览部署复制生产任务后启用真实 cron。

### 5.2 导出并恢复到空目标库

使用合适版本的 PostgreSQL 客户端，并通过安全方式设置下列 shell 变量；不要把真实 URL 写进文档或共享命令记录。

```zsh
# SOURCE_DATABASE_URL / NEON_DIRECT_URL 需预先在当前终端安全设置。
# 备份位于仓库外；包含客户数据，限制权限并按运营策略保管。
umask 077
pg_dump --format=custom --no-owner --no-acl \
  --dbname="$SOURCE_DATABASE_URL" --file="$HOME/booth-db-backup.dump"
pg_restore --list "$HOME/booth-db-backup.dump"
pg_restore --exit-on-error --no-owner --no-acl \
  --dbname="$NEON_DIRECT_URL" "$HOME/booth-db-backup.dump"
```

使用完整数据库导出，保留应用表、约束、索引以及实际迁移记录；不要只导出 `rap_*`。恢复目标应为空库，不先执行一遍建表迁移再覆盖恢复，也不使用 `--clean` 删除现有库。

迁移历史通常在数据库的 `drizzle.__drizzle_migrations`，需按实际库核实。恢复已有历史后，先检查历史与仓库一致，再运行缺失的迁移。不能只凭 `drizzle/meta/_journal.json` 判断数据库已应用哪些 SQL。

官方操作参考：[Neon pg_dump / pg_restore 迁移](https://neon.com/docs/import/migrate-from-postgres)。导出恢复可能涉及扩展和权限兼容，任何报错都应先解决，不能把部分恢复当作切换成功。

### 5.3 校验与切换

对源、目标分别核对：

- `user`、`account`、`session`、`payment`、`payment_event`、`rap_order`、`rap_generation`、`rap_asset`、`rap_moderation`、`rap_audit` 的行数与关键关联。
- 已付款订单的 paymentId、capture ID、金额、币种和生成记录；失败补发次数及审计。
- R2 Key 对应对象存在；待审核与待生成任务没有因为复制被额外提交。
- 保留历史订单 snapshot，不将旧 8 秒订单批量改成新 10 秒模板。

将应用环境的 `DATABASE_URL` 改为 Neon pooled 地址并重新部署。先进行登录、订单查询和权限校验，再恢复 cron；对迁移窗口内通知重放、未结算订单和未知提交逐条核查。生成开关仍须遵守单独的调用授权。

### 5.4 回退

尚未恢复新库写入时，可回退连接到冻结的旧库并重新部署。Neon 开始接收订单或付款后，不能直接切回旧库：先暂停写入，核对差异、付款和任务状态，完成数据回迁/对账后再切换，避免丢账或重复生成。源库和备份在验收完成前保留。

## 6. 只读检查

使用 SQL 编辑器或可信数据库客户端执行，不需要访问业务媒体：

```sql
SELECT current_database(), current_user;
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema IN ('public', 'drizzle')
ORDER BY table_schema, table_name;
SELECT status, count(*) FROM rap_order GROUP BY status;
SELECT status, count(*) FROM rap_generation GROUP BY status;
SELECT status, count(*) FROM rap_moderation GROUP BY status;
```

使用 `pnpm db:studio` 时，它也走 `drizzle.config.ts`，因此当前读取的仍是 `DATABASE_URL`。不要将管理界面公开到互联网。

## 7. 测试与验收

- `RAP_TEST_DATABASE_URL` 指向专用空测试库。现有 PG 集成测试创建隔离 schema 并在结束时删除它，不能使用生产凭证。
- 默认 `pnpm test` 未配置该变量时会跳过 PG 集成测试；跳过不等于数据库已验证。
- 修改连接代码/迁移配置后运行 `pnpm lint`、`pnpm test`、`pnpm build`。
- 检查注册奖励、已有登录、订单归属、付款幂等、审核租约与到期清理；真实支付、审核和生成另行安排受控联调。
- 数据库角色需具备应用所需表权限；用于迁移/测试的角色另需建表或建 schema 权限。

## 8. 常见问题

| 现象 | 检查 |
| --- | --- |
| 连接失败 | Connect 面板的主机、角色、库名、SSL 参数、网络；不要关闭 TLS 校验排障 |
| 表不存在 | 是否切到了新空库，是否完整运行迁移，环境是否读错变量 |
| 迁移提示表已存在 | 是否混用 dump 恢复与建表迁移，是否缺少源库迁移历史 |
| 登录后用户/订单消失 | 是否新建了空库而没有导入旧数据 |
| `relation`/权限错误 | 数据库角色、schema search_path 与迁移权限 |
| 改文件后仍连接旧库 | shell/Vercel 变量覆盖、服务未重启、部署未更新 |
| 审核/生成不动 | 数据库切换不负责调度，继续检查外部 cron 和业务开关 |
