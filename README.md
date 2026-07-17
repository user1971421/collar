# Collar

Collar 是一个手机端优先、local-first 的 AI 训练终端，用于成年、自愿、私密关系中的持续角色扮演。

它不是普通 TODO，也不是随机任务卡片。一次完整流程是：

```text
戴上项圈
  -> 选择 Gentle / Routine / Ruined
  -> 写一句给 <char> 的话
  -> AI 回应并下发任务
  -> 执行 / 等待 / 隐藏计时
  -> 汇报
  -> 验收
  -> 奖励、补交或惩罚
  -> 本地归档
```

仓库默认使用 `<char>` 和 `<user>` 作为角色占位符。默认 Profile、API Key、长期目标和状态文本均为空，不包含作者的私人设定或使用记录。

## 功能

- Gentle、Routine、Ruined 三套独立状态设定。
- Shape Your Pet：Training 与 Punishment 长期规则。
- 严格 JSON 的 AI 任务生成与验收。
- mock、user-key、backend-proxy 三种 AI 模式。
- 隐藏倒计时、可见倒计时和固定计时。
- 计时页面点击生成 `🐾` 与 `<char>` 口吻气泡。
- 汇报、验收、奖励延迟和完整本地归档。
- 六项动态数值与最近七天历史摘要。
- 连续打卡、累计打卡和最长连续天数。
- 自定义 UTC+8 训练日起始时间。
- D+0 提醒、D+1 常驻、D+2 锁定的惩罚欠账。
- 原任务缺失项补交与独立惩罚分离。
- JSON 导入、导出、宽容修复和全部数据清空。
- PWA manifest，可安装到手机主屏幕。

## 快速开始

需要 Node.js 20 或更高版本。

```bash
git clone https://github.com/user1971421/collar.git
cd collar
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

首次运行默认进入 `mock` 模式，不会请求外部 API。

## 第一次配置

打开底部的“设置”。

### 1. 填写 Profile

Profile 是角色关系和基础边界。默认值只有占位符：

```json
{
  "ownerName": "<char>",
  "petName": "<user>",
  "relationshipType": "",
  "tone": "",
  "kinkTags": [],
  "hardLimits": [],
  "softLimits": [],
  "preferredTaskTypes": [],
  "forbiddenTaskTypes": [],
  "aftercareStyle": "",
  "language": "简体中文",
  "explicitnessLevel": 1,
  "intensityDefault": 1
}
```

将 `<char>` 和 `<user>` 替换为自己的角色称呼，填写关系、语气、偏好与边界，然后点击“识别并写入 Profile”。

Profile 只保存在当前浏览器的 `localStorage`。

### 2. 配置五块长期设定

设置页顶部提供“复制 AI 生成 Prompt”。将 Prompt 交给熟悉双方设定的 AI，再把返回 JSON 粘贴到 Collar，即可自动分配：

```json
{
  "shapeYourPet": {
    "training": "长期塑造方向",
    "punish": "独立惩罚生成规则"
  },
  "petToday": {
    "gentle": "Gentle 状态规则",
    "routine": "Routine 状态规则",
    "ruined": "Ruined 状态规则"
  }
}
```

导入器会尝试修复中文引号、尾逗号、外层括号和常见字段拼写问题。每个文本块也可以折叠预览并直接编辑。

`Training` 定义长期塑造目标。`Punishment` 只定义验收失败后另行生成的惩罚，不代替原任务缺失项补交。

### 3. 设置计时与训练日

- **最长计时**：AI 可以查阅，但前端会再次强制截断，AI 不能突破。
- **固定计时**：开启后，所有计时任务直接使用设置的时长。
- **隐藏倒计时**：开启后执行页面不显示剩余数字。
- **每日早安时间**：UTC+8 下新训练日的起点。
- **声音 / 震动**：计时结束时使用，受浏览器权限与设备支持限制。

例如早安时间设为 `08:00`：

- 当天第一次接受任务前显示“戴上项圈”。
- 接受过任务后，到次日 `08:00` 前显示“摇摇铃铛”。
- 次日 `08:00` 起重新显示“戴上项圈”。

## AI 模式

### mock

本地生成模拟任务和验收，不调用网络。适合开发、演示和离线测试。

### user-key

浏览器直接调用 OpenAI-compatible `/chat/completions` 接口。

需要填写：

- Base URL
- API Key
- Model
- Temperature
- Max Tokens

API Key 仅保存在当前浏览器的 `localStorage`，导出 JSON 时会自动清空。

不要在多人使用的网站或不可信设备上使用 `user-key`。

### backend-proxy

浏览器调用本项目的：

- `POST /api/generate-task`
- `POST /api/generate-verdict`

复制环境变量模板：

```bash
cp .env.example .env.local
```

填写：

```dotenv
COLLAR_API_BASE_URL=https://api.example.com/v1
COLLAR_API_KEY=
COLLAR_MODEL=
COLLAR_TEMPERATURE=0.85
COLLAR_MAX_TOKENS=2400
```

重启开发服务器后，在设置中选择 `backend-proxy`。

API Key 只存在服务器环境变量中，不进入浏览器 bundle。仓库没有内置账号系统；若部署到公网，请在反向代理或应用层为页面和两个 API Route 增加认证、限流与访问控制。

## 每日使用

1. 点击“戴上项圈”或“摇摇铃铛”。
2. 选择本次状态。
3. 写一句给 `<char>` 的话。
4. 点击“交给 `<char>`”。
5. 阅读回应、完成条件和任务步骤。
6. 点击开始执行。
7. 计时结束或手动结束无计时任务。
8. 填写达到最低字数的汇报。
9. 接受验收结果并归档。

AI 返回无法解析、字段不合法或代理请求失败时，前端会在控制台记录错误并回退到 mock 任务或本地验收。

## 验收、补交与惩罚

普通任务未通过时，系统会同时保存两件事：

1. **Makeup**：只补原任务里明确遗漏、跳过或无法证明完成的项目。
2. **Punishment**：根据 Shape Your Pet / Punishment 文本另行生成的独立任务。

执行顺序是：

```text
原任务未通过
  -> 补齐缺失项
  -> 独立惩罚
  -> 惩罚验收
```

惩罚首次未通过时只允许再补交一次。第二次仍未通过，不再无限生成任务，而是关闭欠账并按照惩罚强度结算坏猫值。

### 点数规则

| 结果 | 数值变化 |
| --- | --- |
| 普通任务通过 | 应用该任务的 AI `statDelta` |
| 普通任务未通过 | 反抗 +1，坏猫 +1 |
| 原任务补交未通过 | 不重复加点，继续保留欠账 |
| 原任务补交通过 | 顺从 +1，反抗 -1 |
| 惩罚首次未通过 | 不加点，开放唯一一次补交 |
| 惩罚第二次未通过 | 反抗 +1，坏猫 +惩罚强度（1-5），关闭欠账 |
| 惩罚通过 | 顺从 +1，反抗 -1，坏猫 -1 |

每项数值最终会限制在 `0-999`。

### 欠账时间规则

- **D+0 22:00 后**：首页提醒当日惩罚未完成。
- **D+1**：惩罚常驻首页。
- **D+2**：新的普通训练锁定，必须先处理到期欠账。

紧急退出不会生成新的惩罚，但当前补交或惩罚仍保持未完成。

## 数据与隐私

运行数据全部保存在浏览器：

```text
localStorage key: collar.state.v1
```

包括：

- Profile
- 五块长期设定
- 终端设置
- 当前任务
- 训练记录
- 数值
- 惩罚欠账

设置页可导出或导入 JSON。导出时 API Key 强制为空。

清除站点数据、浏览器存储或卸载浏览器可能删除全部记录，请定期导出备份。仓库不会收集遥测，也不会上传本地归档。

## 开发

```bash
npm run typecheck
npm test
npm run build
```

核心目录：

```text
src/app/                         Next.js 页面与 API Routes
src/components/CollarTerminal.tsx 终端 UI 与前端状态机
src/lib/collar/schema.ts         Zod schema、默认配置与类型
src/lib/collar/prompts.ts        任务生成与验收 Prompt
src/lib/collar/ai-client.ts      三种 AI 模式与 fallback
src/lib/collar/discipline.ts     训练日、欠账与惩罚状态机
src/lib/collar/history.ts        打卡和最近历史摘要
src/lib/collar/storage.ts        localStorage 与导入导出
tests/collar.test.ts             核心行为测试
```

## 部署

```bash
npm run build
npm run start
```

也可以部署到支持 Next.js App Router 的平台。使用 `backend-proxy` 时必须在部署平台配置服务器环境变量。

公开实例应额外配置：

- 登录或反向代理认证
- API Route 限流
- HTTPS
- 安全响应头
- 日志脱敏
- 环境变量密钥轮换

## 内容与使用边界

Collar 面向明确成年、自愿、私密的虚构或现实角色扮演。生成规则明确排除未成年人、公开暴露、违法行为、真实非自愿、窒息风险、真实医疗操作和不可撤回的现实伤害。

软件不会替代医疗、法律或心理健康专业意见。用户应根据自己的关系约定、身体状况和现实环境配置 Profile 与边界，并保留随时中止任务的能力。

## License

[MIT](LICENSE)
