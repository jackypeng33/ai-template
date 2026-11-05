# BOOTH 私有 R2 配置与验收

Rap 客户照片和视频采用 AWS SDK v3 写入私有 R2；公开 demo 资产与现有通用存储保持独立。数据库保存 Object Key，不使用公开 CDN 地址。审核请求所需签名 URL 属于短期敏感信息，不对用户返回或记录到日志。

## Cloudflare 控制台

1. R2 → Create bucket，新建专用私有桶（例如 `booth-private`），保持 Public access / r2.dev 关闭，不绑定公开自定义域名。
2. Manage R2 API Tokens → Create API Token，Object Read & Write，限制到该桶；把 Access Key ID、Secret Access Key 保存到本地/Vercel 服务端环境变量。
3. 桶 Settings → CORS，添加可信前端 Origin；开发例子如下，生产部署替换成实际 HTTPS 域名，不能使用通配 Origin。

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 300
  }
]
```

4. 桶 Settings → Object lifecycle，新增仅匹配 `temp/` 前缀的 1 天删除规则，清理未确认和重复 PUT 产生的临时文件。不要给 `rap/` 正式媒体前缀设置全桶删除规则；正式媒体由应用按业务期限清理。
5. 配置每分钟携带 cron 密钥访问 `/api/cron/rap-video` 的托管调度。删除失败保留记录下次重试。

## 本地和 Vercel 环境变量

优先沿用现有命名：

```dotenv
RAP_STORAGE_BUCKET="booth-private"
STORAGE_ENDPOINT="https://<account-id>.r2.cloudflarestorage.com"
STORAGE_REGION="auto"
STORAGE_ACCESS_KEY_ID="<private-bucket-token-access-key>"
STORAGE_SECRET_ACCESS_KEY="<private-bucket-token-secret>"
```

也支持 `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME`，仅在对应旧配置为空时使用；`RAP_STORAGE_BUCKET` 优先。不会回退到可能公开的 `STORAGE_BUCKET_NAME`。`R2_PUBLIC_URL` 和 `STORAGE_PUBLIC_URL` 不用于 Rap 私有媒体。

密钥不加 `NEXT_PUBLIC_`，本地写入未提交的 `.env.local`，Vercel Project → Settings → Environment Variables 中按环境设置并重新部署。Preview 和 Production 使用独立桶/Token。未配置远端存储时保留开发文件降级，但直传与真实审核必须使用私有桶。不要复制示例占位值作为实际配置。

审核还需要 `SEEAPI_API_KEY`；`RAP_MODERATION_ENABLED` 默认 false。仅有 R2 或审核密钥不会开启视频生成，原四个业务开关继续 OFF，直至受控联调、音乐权利和质量验收完成。

## 接口和一致性

登录用户向 `POST /api/rap/uploads` 提交 `{contentType,size}`，服务端分配随机临时 Key 并发出 5 分钟 PUT URL；每用户每小时最多 40 个上传意图。浏览器 PUT 后请求 `POST /api/rap/uploads/{id}/complete`。服务端检查归属、HEAD 大小/类型、有限大小读取和真实图片解码，再保存到新的不可变规范化 Key 并排审核。上传签名只能覆写临时文件，不能修改审核通过的业务文件。

私有媒体仅通过受鉴权、归属和审核限制的媒体接口交付。审核使用原始 R2 S3 Endpoint 生成签名 URL，不能把 URL 域名替换为 CDN 域名。SDK 客户端缓存复用，连接/请求带超时，上传后 HEAD 确认长度；R2 写入失败不会标记业务可交付。

## 端到端验收（需要另行配置真实环境）

- 登录 A 上传合法照片，确认原始临时文件和规范化私有文件；通过模拟/受控审核后才能付款。
- B 请求 A 的上传确认/素材/媒体，应失败；未登录申请签名应失败。
- 声明错误类型、错误长度、非图片字节、超限数据，确认失败；不可把普通文件伪装成图片。
- 重复确认不重复创建资产；签名过期不能 PUT；旧签名改写 raw Key 后不改变已规范化资产或审核结果。
- 生成结果转存模拟 R2 失败时不可完成；恢复后重试不重新生成。
- 审核未通过前不能播放、下载或发送完成邮件；只有通过后开始 7 天期限。
- 删除失败保留 Key 重试；24 小时临时清理与正式媒体清理独立；已清理文件不能被晚到审核恢复。
- Cloudflare Metrics 观察操作次数与存储用量；应用不记录完整签名地址或客户媒体。

本文不表示已配置 Cloudflare 或已执行真实端到端验收。
