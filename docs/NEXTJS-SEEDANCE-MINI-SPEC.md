# Next.js 双人说唱视频接入 Spec：KIE Seedance 2.0 Mini

版本：1.0。整理日期：2026-10-27。适用对象：已有 Next.js + TypeScript 项目。目标是复用一次已经真实成功的“两张人物照片 + 一段音频 → 双人说唱视频”调用，形成可持续查询、避免重复提交的产品功能。

## 1. 给接入项目的执行说明

可以将本文完整交给目标项目的开发者或编码代理：

> 请按本 Spec 接入 KIE 的 `bytedance/seedance-2-mini`。复用项目已有鉴权、数据库、对象存储、任务队列和UI组件，不强制升级Next.js，也不另建Python服务。先实现模拟接口测试与本地流程，默认480p、4秒、16:9；真实生成需由用户明确触发。不得自动批量生成、自动切换模型、在提交结果不明时自动重发。供应商密钥只留在服务端。实现后交付参数预览、创建任务、状态查询、播放下载，以及明确的验收记录。

本文中：

- **已实测**：来自本次Python POC实际请求及响应。
- **平台约束**：来自KIE官方文档，需要接入时再次核实。
- **项目设计**：建议在Next.js项目实现的接口与数据结构，不是KIE官方接口。

## 2. 已成功的最小基线

| 项目 | 本次已实测值 |
| --- | --- |
| 提供商 | kie.ai |
| 模型 | `bytedance/seedance-2-mini` |
| 输入 | 两张人物JPEG + 一段4秒WAV，图片顺序固定为左侧人物、右侧人物 |
| 请求 | 480p、4秒、16:9、`generate_audio=true` |
| 生成次数 | 一个视频生成任务，无额外舞台图片生成调用 |
| 实际KIE积分消耗 | **15.2** |
| 平台返回处理时间 | `costTime=101` 秒；与含排队、查询间隔的本地总等待时间不同 |
| 本地提交至观察到成功 | 约126秒，不构成延迟承诺 |
| 原生音轨 | 有，AAC；最终导出保留了该音轨 |
| 已下载的最终文件 | H.264，24fps，864×496，FFmpeg报告约4.04秒 |

成功任务ID：`34bcbf6325c5fa7ef5b7c84155d55a25`。此ID仅用于追溯本次成功记录，不得在其他用户或项目中作为自己的任务ID硬编码。

**实测证明的是API链路成功、产生了可解码且带音轨的视频；没有做标准化人脸相似度、指定人物口型或原始音轨逐字复现的质量验收。**

请求480p不应被前端硬编码为文件高度恰好480，请求4秒也不应要求容器时长精确等于4.000秒。以播放器和实际媒体元数据展示结果，允许正常编码及封装差异。

## 3. P0范围及默认参数

P0只实现：选两张照片、选音频、预览参数及预算、用户创建一个任务、持续查询、播放和下载结果。无需实现充值订阅、模板商城、自动写歌、声纹克隆、多模型路由或多候选生成。

| 参数 | P0默认值 | 服务端规则 |
| --- | --- | --- |
| `model` | `bytedance/seedance-2-mini` | 服务端固定，不能接受客户端任意模型名 |
| `duration` | `4` | P0固定4秒；以后可开放4–15整数秒，禁止自动时长`-1` |
| `resolution` | `480p` | P0固定480p；720p作为后续显式升级选项 |
| `aspect_ratio` | `16:9` | P0固定，后续可开放已验证的画幅 |
| `generate_audio` | `true` | 保留原生音画输出用于评估 |
| `web_search` | `false` | 当前不用联网搜索 |
| `nsfw_checker` | `true` | 保留内容检查 |
| `reference_image_urls` | 恰好2项 | 第1项为左侧主唱，第2项为右侧配合者 |
| `reference_audio_urls` | 恰好1项 | 首轮使用4秒清晰人声WAV |

使用多模态参考模式，不传`first_frame_url`、`last_frame_url`或`reference_video_urls`。没有`num_frames`、`frames_per_second`等旧接口参数。模型支持的其他字段不在P0范围内。[KIE Mini接口文档](https://docs.kie.ai/market/bytedance/seedance-2-mini)

### 3.1 素材准备

产品第一版只接受JPEG、PNG、WebP人物照及WAV、MP3音频。图片每边大于300像素，宽高比在0.4至2.5之间；规范化时处理EXIF旋转、转RGB，最长边控制在1536像素并输出JPEG质量92。这是对齐本次POC的处理策略，不是模型要求必须1536像素。

KIE文档的图片上限为单张小于30MB，音频单文件不超过15MB，参考音频时长2–15秒。项目可以设置更小的上传限制；应同时检查文件大小、文件签名、实际可解码性和图像尺寸，不能只信浏览器提交的MIME类型。

为复现成功样例，参考音频规范化为44100Hz、单声道、16位PCM WAV，完整时长4秒。原始歌曲应由用户先选择片段，处理完成后再预览；不允许创建任务后才发现不足4秒。**音频规范化是可复现策略，不是KIE只接受这一采样率。**

已有4秒WAV可直接使用；需要MP3裁剪、音频验时长等操作时复用项目已有媒体处理能力或后台媒体Worker，不要求把FFmpeg装进Next.js每个Route Handler。

### 3.2 固定模板提示词

服务端使用模板ID `orange-booth-duo-v1`，而不是默认接受任意客户端提示词。模板内容：

```text
时长与请求中的 duration 一致，横屏16:9，固定机位，一镜到底。两位虚构成年人物在橙色录音棚中同框，胸部以上中景，一支悬挂麦克风在两人之间。
第1张人物参考图中的蓝色上衣男性站在画面左侧，作为主唱；第2张人物参考图中的酒红色上衣女性站在画面右侧，作为配合者。
严格保留各自不同的脸部特征、发型和服装，不能交换身份，不能增加第三个人，不能让两张脸融合。
以参考音频为节奏和演唱内容依据，左侧男性清晰演唱：“站上舞台，跟着节拍，左边开麦，一起摇摆”。嘴部动作随音节同步，只做幅度自然的小手势。
右侧女性保持闭嘴，轻轻点头跟拍，不演唱。不要切换镜头，不添加文字、字幕或标识。
```

上面是本次成功样例的固定提示词，适用于随本文提供的蓝衣男、红衣女、指定歌词。正式支持用户自选素材时，必须改用身份中性的描述：“第1张参考图中的人物在左侧、第2张参考图中的人物在右侧”，不硬编码性别、衣服颜色或本次歌词；两套模板应分版本保存。衣服、人物角色和歌词不得与用户素材矛盾。

## 4. KIE供应商契约：已实测

### 4.1 文件上传

```http
POST https://kieai.redpandaai.co/api/file-stream-upload
Authorization: Bearer <KIE_API_KEY>
Content-Type: multipart/form-data; boundary=<由FormData自动生成>
```

字段：`file`为二进制文件；`uploadPath`为应用隔离目录，例如`rap-videos/<随机目录ID>`；`fileName`为唯一随机文件名。返回示例：

```json
{
  "success": true,
  "code": 200,
  "msg": "File uploaded successfully",
  "data": {
    "downloadUrl": "https://tempfile.redpandaai.co/example/reference.jpg"
  }
}
```

只把`data.downloadUrl`存入服务端资产记录，后续作为模型输入。上传同名文件可能覆盖已有文件，所以文件名使用UUID，不使用用户原始文件名。KIE公开文档说明上传文件24小时后删除，应记录`uploadedAt`、`expiresAt`；超过有效期且尚未提交时重新上传源文件，不能继续使用过期地址。[上传文档](https://docs.kie.ai/file-upload-api/upload-file-stream)

### 4.2 创建视频任务

```http
POST https://api.kie.ai/api/v1/jobs/createTask
Authorization: Bearer <KIE_API_KEY>
Content-Type: application/json
```

请求体如下，`prompt`完整文本使用3.2节模板；示例URL必须替换成新上传且可访问的地址：

```json
{
  "model": "bytedance/seedance-2-mini",
  "input": {
    "reference_image_urls": [
      "https://tempfile.redpandaai.co/example/left.jpg",
      "https://tempfile.redpandaai.co/example/right.jpg"
    ],
    "reference_audio_urls": [
      "https://tempfile.redpandaai.co/example/audio.wav"
    ],
    "prompt": "使用3.2节完整模板内容",
    "duration": 4,
    "resolution": "480p",
    "aspect_ratio": "16:9",
    "generate_audio": true,
    "web_search": false,
    "nsfw_checker": true
  }
}
```

成功响应：

```json
{
  "code": 200,
  "msg": "success",
  "data": { "taskId": "provider_task_id" }
}
```

P0不传`callBackUrl`，使用后台轮询。本地幂等键不是KIE参数，不要把未公开的幂等字段添加到上述请求。

### 4.3 查询同一个任务

```http
GET https://api.kie.ai/api/v1/jobs/recordInfo?taskId=<providerTaskId>
Authorization: Bearer <KIE_API_KEY>
```

必须检查HTTP状态和JSON的`code`，HTTP 200不代表业务成功。常见远端状态为`waiting`、`queuing`、`generating`、`success`、`fail`。成功响应关键字段：

```json
{
  "code": 200,
  "msg": "success",
  "data": {
    "taskId": "provider_task_id",
    "model": "bytedance/seedance-2-mini",
    "state": "success",
    "resultJson": "{\"resultUrls\":[\"https://tempfile.aiquickdraw.com/example/video.mp4\"]}",
    "creditsConsumed": 15.2,
    "costTime": 101
  }
}
```

`resultJson`实际为JSON字符串，解析后读取`resultUrls[0]`。如接口返回对象形式，可兼容对象；成功却没有有效URL时标记“结果解析待处理”，续查原taskId，不能再次创建生成任务。缺失的实际积分存`null`，排队时返回的0不视为最终账单。保存`failCode`和`failMsg`，不要直接把供应商原始错误响应返回浏览器。[任务查询文档](https://docs.kie.ai/market/common/get-task-detail)

## 5. Next.js项目结构与部署边界

下面目录名为建议，可按项目现有组织方式调整：

```text
app/
  rap-video/page.tsx
  api/rap-video-assets/route.ts
  api/rap-videos/plan/route.ts
  api/rap-videos/route.ts
  api/rap-videos/[generationId]/route.ts
  api/rap-videos/[generationId]/download/route.ts
lib/rap-video/
  kie.server.ts
  validation.ts
  prompt.ts
  repository.ts
  service.ts
workers/
  rap-video-submit.ts
  rap-video-status.ts
  rap-video-persist.ts
```

服务端供应商模块使用`import 'server-only'`，密钥只读`process.env.KIE_API_KEY`，不得使用`NEXT_PUBLIC_`前缀。执行上传、存储SDK或媒体处理的Route Handler按项目版本选择Node运行时，例如`export const runtime = 'nodejs'`。鉴权、数据库、队列、存储沿用目标项目，不在本文指定ORM或云厂商。

使用App Router的Route Handler；已有Pages Router的项目可实现同样HTTP契约，不必为本功能迁移整站。[Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers)、[环境变量](https://nextjs.org/docs/app/guides/environment-variables)

环境变量示例：

```dotenv
KIE_API_KEY=
# 复用项目已有DATABASE_URL、队列和对象存储环境变量
```

**生成可能耗时数分钟，不要在Route Handler中循环等待生成完成，也不要在返回响应后启动不受管理的Promise/setInterval作为后台任务。** 创建接口只落库并可靠入队，返回202；独立Worker或项目现有持久化任务系统负责提交、查询和结果转存。队列消息必须携带本地generationId而不是一份可反复执行的创建请求。

上传限制和执行时长受部署平台影响。小文件可通过服务端`request.formData()`接收；大文件使用项目对象存储预签名直传，再由Worker向KIE转交。浏览器不能获得KIE API Key。

## 6. 项目自己的HTTP接口

以下全部要求登录并验证资源属于当前用户；本地generationId、assetId与供应商taskId分开管理。

### 6.1 `POST /api/rap-video-assets`

请求：multipart，字段`file`和`kind`，`kind`为`portrait`或`audio`。每次上传一个文件。源文件先进入项目自己的存储，完成验证及规范化，然后上传KIE；耗时较长时返回资产状态`processing`，由项目已有资产任务机制继续处理。

成功且可用于生成时返回：

```json
{
  "assetId": "asset_local_id",
  "kind": "portrait",
  "status": "ready",
  "previewUrl": "https://app-storage.example/signed-preview.jpg",
  "metadata": { "width": 1086, "height": 1448 }
}
```

音频metadata增加`durationSeconds`、`mimeType`。客户端只提交assetId，不允许任意外部URL进入创建接口。对尚未ready、过期或其他用户的资产，计划接口必须拒绝。

### 6.2 `POST /api/rap-videos/plan`

请求：

```json
{
  "leftAssetId": "asset_left",
  "rightAssetId": "asset_right",
  "audioAssetId": "asset_audio",
  "templateId": "orange-booth-duo-v1"
}
```

服务端固定P0参数、解析自有资产、保存不可变参数快照及requestHash，返回planId。**本接口不创建KIE生成任务。**

```json
{
  "planId": "plan_local_id",
  "model": "bytedance/seedance-2-mini",
  "duration": 4,
  "resolution": "480p",
  "aspectRatio": "16:9",
  "generateAudio": true,
  "estimatedProviderCredits": 15.2,
  "priceAsOf": "2026-10-26",
  "expiresAt": "2026-10-27T10:15:00Z"
}
```

计划TTL可由项目设置为15分钟，且不得超过输入素材URL的有效期；资产重新处理、模板或参数改变时使旧计划失效。所有日期示例仅演示格式。预算是KIE供应商积分，不等于项目向最终用户出售的积分。

### 6.3 `POST /api/rap-videos`

请求头包含`Idempotency-Key: <本次用户操作的UUID>`，请求体为`{"planId":"plan_local_id"}`。同一个用户、同一个幂等键、同一计划重试时返回同一本地generationId；若同键对应不同计划或参数，返回409。

优先按当前用户及幂等键查找已存在的generation并返回它，即使原计划此时已经过期，也不能因此产生新任务。首次创建才在数据库事务中完成：验证计划、创建generation、写入可靠队列/outbox事件。返回202：

```json
{
  "generationId": "gen_local_id",
  "status": "created",
  "estimatedProviderCredits": 15.2,
  "pollAfterMs": 5000
}
```

这是本地请求已受理，不表示KIE已接受或已成功。浏览器收到网络超时后，必须使用同一幂等键重试本接口，不生成新键。按钮防连点不能代替数据库唯一约束。

### 6.4 `GET /api/rap-videos/:generationId`

仅查询项目数据库，不在每次页面刷新时发起新的KIE请求。返回`Cache-Control: private, no-store`：

```json
{
  "generationId": "gen_local_id",
  "status": "succeeded",
  "model": "bytedance/seedance-2-mini",
  "duration": 4,
  "resolution": "480p",
  "actualCreditsConsumed": 15.2,
  "playbackUrl": "https://app-storage.example/signed-result.mp4",
  "downloadUrl": "/api/rap-videos/gen_local_id/download",
  "error": null
}
```

未成功时playbackUrl和downloadUrl为null；实际积分未结算或未返回时为null。前端约5秒查询一次，逐渐退避至10–20秒；终态停止查询，组件卸载时清理定时器。等待时间可展示，不伪造精确进度百分比。关闭页面不取消已创建的任务。

### 6.5 `GET /api/rap-videos/:generationId/download`

鉴权且状态为succeeded后，生成项目存储短时签名下载地址并跳转，或安全代理已持久化结果。使用合适的Content-Type和Content-Disposition，不接收浏览器传入的任意下载URL。

## 7. 持久化、状态机与防重复生成

### 7.1 最小数据模型

| 实体 | 关键字段 |
| --- | --- |
| Asset | `id,userId,kind,sourceStorageKey,normalizedStorageKey,mimeType,sizeBytes,sha256,metadata,providerUrl,providerUrlExpiresAt,status` |
| GenerationPlan | `id,userId,assetIds,templateVersion,requestSnapshot,requestHash,priceSnapshot,estimatedCredits,expiresAt` |
| VideoGeneration | `id,userId,planId,idempotencyKey,requestHash,status,provider,model,providerTaskId,providerState,submittedAt,completedAt,actualCredits,failCode,failMsg,nextPollAt,leaseOwner,leaseExpiresAt,version` |
| GenerationResult | `generationId,sourceResultUrl,storageKey,metadata,persistStatus,lastPersistError` |
| Outbox/Job | `generationId,kind,availableAt,attempt,lease`，复用已有持久化任务系统 |

约束：`UNIQUE(userId,idempotencyKey)`；`UNIQUE(provider,providerTaskId)`，允许taskId未产生时为null。积分使用decimal或最小整数单位，避免浮点累计误差。请求快照包含素材顺序、模板版本和参数，不能在提交后静默修改。

### 7.2 状态流

```text
created → submitting → queued → generating → provider_succeeded → persisting → succeeded
                └→ submission_unknown                         └→ 持久化失败后重试转存
                            queued / generating → failed
```

- Worker用事务或CAS领取created任务，保存submitting及提交尝试标识后，只调用一次KIE createTask。
- 收到有效taskId后立即持久化，再转queued；收到generating后更新状态。
- 查询可能直接从waiting得到success，无需先观察到每个中间态；终态不能被延迟到达的非终态响应回退。
- 提交过程中断网、超时、响应无法解析、响应缺少taskId、或者进程在拿到taskId但落库前崩溃：进入或保留**submission_unknown**，不得自动再次调用createTask。即使重启/队列重投，也只进入核对流程。
- submitting租约过期不能直接重置created，因为上游可能已经接受了付费请求。需要在KIE日志中核对并人工绑定taskId，或在确认未创建后由用户发起新的实验。
- 已有taskId后，只能通过recordInfo续查；查询超时不表示生成失败，也不清除taskId。页面可显示“查询延迟”。
- 远端成功后先记录provider_succeeded，再可靠转存；下载失败只重试下载，不生成新视频。
- fail为生成终态，不自动重发。用户明确选择“重新生成”时才新建一份可独立计费的generation。
- 同一任务的提交、查询、转存由独立lease/CAS控制，防止多Worker重复执行或乱序状态覆盖。

本地幂等不能消除远端POST与本地数据库之间的全部不确定窗口。Spec不承诺上游exactly-once；用submission_unknown和人工核对避免静默重复计费。

## 8. Next.js服务端供应商适配示例

以下仅是可复制的供应商HTTP适配，**不包含鉴权、资产验证、数据库事务和Worker调度**；不能直接暴露给客户端调用。无第三方KIE SDK依赖，使用Node原生fetch/FormData。

```ts
// lib/rap-video/kie.server.ts
import 'server-only';

export const MODEL = 'bytedance/seedance-2-mini' as const;
const API = 'https://api.kie.ai/api/v1/jobs';

function authorization(): Record<string, string> {
  const key = process.env.KIE_API_KEY?.trim();
  if (!key) throw new Error('KIE_API_KEY is not configured');
  return { Authorization: `Bearer ${key}` };
}

async function readEnvelope<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok || body.code !== 200 || body.success === false) {
    // 不向客户端或日志原样透出响应正文、文件URL或鉴权信息。
    throw new Error(`KIE_REQUEST_FAILED:${response.status}:${body.code}`);
  }
  return body.data as T;
}

export async function uploadReference(file: File): Promise<string> {
  const form = new FormData();
  const extension = file.type === 'audio/wav' ? 'wav' : 'jpg';
  form.set('file', file); // 调用者只传已规范化的JPEG或WAV
  form.set('uploadPath', 'rap-videos/references');
  form.set('fileName', `${crypto.randomUUID()}.${extension}`);
  const response = await fetch(
    'https://kieai.redpandaai.co/api/file-stream-upload',
    {
      method: 'POST', headers: authorization(), body: form,
      cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(120_000),
    },
  );
  const data = await readEnvelope<{ downloadUrl: string }>(response);
  if (!data?.downloadUrl?.startsWith('https://')) throw new Error('KIE_UPLOAD_INVALID');
  return data.downloadUrl;
}

export function buildRequest(input: {
  leftUrl: string; rightUrl: string; audioUrl: string; prompt: string;
}) {
  // 所有URL来自当前用户已验证的服务端资产记录，不接受客户端任意URL。
  return {
    model: MODEL,
    input: {
      reference_image_urls: [input.leftUrl, input.rightUrl],
      reference_audio_urls: [input.audioUrl],
      prompt: input.prompt, duration: 4, resolution: '480p',
      aspect_ratio: '16:9', generate_audio: true,
      web_search: false, nsfw_checker: true,
    },
  };
}

export async function createProviderTask(request: ReturnType<typeof buildRequest>) {
  // 调用前必须已持久化submitting；本函数不得配置自动重试。
  const response = await fetch(`${API}/createTask`, {
    method: 'POST', headers: { ...authorization(), 'Content-Type': 'application/json' },
    body: JSON.stringify(request), cache: 'no-store', redirect: 'error',
    signal: AbortSignal.timeout(120_000),
  });
  const data = await readEnvelope<{ taskId: string }>(response);
  if (!data?.taskId || typeof data.taskId !== 'string') {
    throw new Error('KIE_SUBMISSION_UNKNOWN');
  }
  return data.taskId;
}

export async function readProviderTask(taskId: string) {
  const response = await fetch(`${API}/recordInfo?${new URLSearchParams({ taskId })}`, {
    headers: authorization(), cache: 'no-store', redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  return readEnvelope<{
    taskId: string; model?: string; state: string;
    resultJson?: string | { resultUrls?: string[] };
    creditsConsumed?: number | null; failCode?: string; failMsg?: string;
  }>(response);
}
```

不要手动为FormData填写Content-Type，fetch需要生成multipart boundary。供应商模块抛出的创建异常由Worker统一按第7节处理，不能由通用HTTP重试中间件自动重发。环境变量应在领取提交任务前做配置检查；若请求尚未发出就发现缺失配置，记录配置错误，不进入反复重试生成的循环。

## 9. 轮询、结果持久化与播放

P0后台查询从约5秒间隔开始，逐步退避至20秒并加入抖动；对GET网络错误、429和临时5xx可退避重试，尊重Retry-After。用户等待15分钟后可以提示“仍在处理中”，不把这个本地等待阈值当作KIE生成失败。后台调度和错误次数上限由项目运维策略配置，保留任务继续核对的能力。

下载resultUrls时：

1. 校验URL为HTTPS；下载服务需有阻止私有网络地址及不安全重定向的策略，不能成为任意URL代理。
2. **不携带KIE Authorization头**，文件CDN不需要该密钥。
3. 流式转存到项目自己的对象存储，设置超时和大小上限；POC上限为256MB，可按平台调整。
4. 保存实际文件元数据；下载/转存失败只重试这个步骤。
5. 存储提供方应支持视频播放所需的Content-Type和Range访问；使用签名URL控制访问。

不能把Next.js部署实例的本地磁盘当作长期结果仓库，也不能把KIE临时CDN地址当永久下载地址。转存前不应把本地状态标记为最终succeeded。

默认保留模型原生音轨，不强制覆盖为输入音频。若要做“原始参考声音”对照，另存一个明确命名的文件，不覆盖原始成片；音频重贴不能证明模型口型同步。P0无需重新转码模型视频，只需保存原始MP4并播放。

页面建议用`<video controls playsInline preload="metadata">`展示结果；显示请求规格和实际元数据，不宣称“严格复刻原歌曲”或“保证双人嘴型一致”。

## 10. 成本与错误处理

计费基线：2026-10-26公开无参考视频档，480p为3.8积分/秒，4秒估算15.2积分；本次成功任务实际也是15.2积分。公开价格可变化，应放到服务端配置并随计划保存快照。不要按“带参考视频”低单价计算图片+音频请求，也不要声称关闭generate_audio可以省钱。[KIE Mini价格](https://kie.ai/seedance-2-0-MINI)

UI区分：供应商预计积分、供应商实际积分、项目自己的用户积分。若目标项目已有计费系统，沿用“预留→实际结算/释放”的幂等账本，不能把15.2直接等同于对用户扣15.2。

| 情况 | 本地处理 |
| --- | --- |
| 未登录、素材非本人所有、参数非法 | 创建前拒绝，不调用KIE生成 |
| 上传失败 | 保留源文件，可重试上传；没有生成任务时不冒充生成失败 |
| createTask异常或响应不明 | submission_unknown，禁止自动重发，待日志核对 |
| recordInfo暂时失败 | 保留taskId，退避续查 |
| KIE state=fail | failed，记录错误及实际积分字段，不自动重新生成 |
| KIE success但结果字段不完整 | 保留同一taskId核对，不能创建新任务 |
| 已成功但下载失败 | 重试下载/转存，保留provider_succeeded或persisting状态 |
| 实际积分字段缺失 | null/待结算，不能填0或用估算冒充实扣 |

## 11. 可选Webhook：不属于P0必需项

如果项目已有公网回调及可靠队列，可为createTask增加服务端固定的callBackUrl。不要接受浏览器传入任意callback URL。

KIE官方验签规则是Base64编码的HMAC-SHA256，签名输入为`taskId + "." + timestampSeconds`，读取`X-Webhook-Timestamp`、`X-Webhook-Signature`；密钥为独立的webhookHmacKey，不是API Key。验证时间窗口、防重放并使用恒定时间比较。

**该签名没有覆盖回调正文。** 验签后只把taskId放入查询队列，再调用recordInfo获得权威结果；不能直接相信回调里的结果URL、金额或状态。重复、乱序回调按taskId幂等处理。[KIE回调验签文档](https://docs.kie.ai/common-api/webhook-verification)

## 12. 验收清单

### 12.1 默认不扣费的自动化验收

- [ ] plan只读取服务端资产和配置，不调用createTask。
- [ ] 请求模型正确，恰好2张照片和1段音频，480p/4秒/16:9/原生音频；没有首尾帧和旧模型字段。
- [ ] 上传、创建和查询检查HTTP状态及JSON code，包括HTTP 200且code=402的情况。
- [ ] 同一Idempotency-Key并发两次只产生一条generation和一次供应商提交机会。
- [ ] 创建后断网、丢失taskId响应、Worker在submitting阶段崩溃，均不会自动重发付费POST。
- [ ] 有taskId后的进程重启只续查；尚未提交的任务不能被“续查”操作意外创建。
- [ ] 远端成功但下载失败后，只重试下载；多次查询/回调不重复转存或重复结算。
- [ ] 本人之外不能访问资产、任务、签名播放/下载地址。
- [ ] 页面刷新、关闭后再进入仍可查看持久化任务；浏览器缓存不返回其他用户状态。
- [ ] 模型原生音频被保留；缺少音轨时可见地提示，而不是静默用本地音轨掩盖问题。
- [ ] 客户端包、API响应、日志均无KIE API Key。

### 12.2 用户授权后的一次真实验收

使用两张测试人物照与4秒音频，只创建一个Mini任务。记录输入哈希、最终请求快照、providerTaskId、状态、处理时间、实扣积分和持久化结果；不以15.2积分作为不变承诺。确认视频可播放且带音轨，再人工评估左右人物、是否串脸、谁在唱和口型节奏。实际质量不达标时先记录问题，不自动提高分辨率、切换标准版或再花积分重跑。

## 13. 本地成功记录与搬迁注意

原项目中可供开发者复核的文件：

- `E:\code\rapvideo-poc\runs\20261026-175632-f89037\run.json`：真实请求和任务状态。
- 同目录`video-record.json`：KIE成功响应，实际15.2积分、costTime=101。
- 同目录`final.mp4`：已生成结果，保留原生音轨。
- `E:\code\rapvideo-poc\inputs\left.png`、`right.png`、`vocals-4s.wav`：原始测试素材。

上述路径仅是开发者的本地证据位置，目标Next.js部署不能依赖E盘路径。素材可复制到目标项目的本地测试fixture目录，线上使用对象存储；API密钥通过目标项目自己的环境变量重新配置。**不要复制run.json中的旧临时素材URL作为长期输入，不要把本次真实taskId当作新任务使用。**

## 14. 接入项目需要自行决定的事项

不影响先实现接口，但合并上线前需明确：现有Next.js路由模式和部署平台、当前用户鉴权方式、数据库/ORM、可靠任务执行器、素材和结果对象存储、项目用户积分计费规则。本文只固定供应商调用和业务边界，不强制引入新的基础设施品牌。
