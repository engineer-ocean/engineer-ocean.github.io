# 站点访客统计（Cloudflare Worker + KV）

首页页脚那句「本站访问 N 次 · 独立访客 M 位 · 来自 K 个城市」的数据来源。

选择自建而不是挂第三方计数器，主要是为了**数据自有**和**控制收集范围**：
第三方脚本会在你的访客身上加载别人的代码，而你无法审计它到底收走了什么。

## 收集什么 / 不收集什么

| 收集 | 存放位置 | 用途 |
|---|---|---|
| 总访问量 | KV `pv` | 页面显示 |
| 独立访客（按日去重后累加） | KV `uv:total` | 页面显示 |
| 城市级计数 | KV `city:<国家>\|<城市>` | 页面显示 |
| 当日去重用的哈希 | KV `uv:<日期>:<哈希>`，**TTL 24 小时自动删除** | 仅用于「今天这个人算过了」 |

**明确不收集**（这几条是设计约束，改 `worker.js` 时不要破坏）：

- **不存原始 IP** —— IP 只在当次请求内参与算哈希，函数返回后即不再被引用
- **不存 User-Agent** —— 同上
- **不留可跨天关联的标识** —— 哈希的盐包含当天日期，每天自动换盐；
  去重键 24 小时后由 KV 自动删除
- **不调用任何第三方 IP 地理库** —— 城市来自 Cloudflare 边缘的 `request.cf`，
  所以也不存在「把访客 IP 转发给第三方」这件事
- 不出售、不共享、不用于广告

匿名化后的聚合计数不属于《个人信息保护法》定义的个人信息（该法第四条），
所以页面上展示城市分布不涉及公开他人个人信息的问题（同法第二十五条）。

## 部署方式 A：一行脚本（推荐）

控制台的 Worker 编辑器每个季度都在改版，`Edit code` 的位置时有时无。
`.dev/deploy_counter.py` 走公开 REST API，一次跑完建 KV、传脚本、写 secret、
开 workers.dev 路由、冒烟测试：

```bash
python .dev/deploy_counter.py --token <CF_API_TOKEN> --enable-frontend
```

token 在 `My Profile → API Tokens → Create Token → Custom token` 建，
权限只勾这两条（**不需要任何 Zone 权限**，本 Worker 不挂在域名上）：

| 权限 | 级别 |
|---|---|
| Account · Workers Scripts | Edit |
| Account · Workers KV Storage | Edit |

脚本会做的事：

1. 校验 token → 列账号（只有一个就自动选，多个要 `--account <id>`）
2. 建 KV 命名空间 `ocean-site-counter`（已存在则复用，不会重复建）
3. 上传 `worker.js`（ES module，绑定名 `COUNTER`）
4. 写 `SALT_SECRET` —— 走 **encrypted secret** 接口，不落 `plain_text`，
   控制台里也回读不到；不传 `--salt` 就自动随机生成
5. 打开 workers.dev 路由，打印 `https://ocean-site-counter.<子域>.workers.dev`
6. 冒烟测试 `/` → `POST /hit` → `/stats`，确认计数真的涨
7. 加了 `--enable-frontend` 就会把地址填进 `assets/js/counter.js` 并刷新版本号

先空跑确认无误：`--dry-run`。

> **如果卡在 `[6/7] 该账号还没注册 workers.dev 子域`**：这是账号级的**一次性**设置，
> API 建不了。去 `Workers & Pages` 首页点一下 “Choose your subdomain”，
> 填一个名字后重跑脚本即可（前几步会复用，不会重复建）。

## 部署方式 B：Cloudflare 控制台（手动）

如果偏好手动点，路径如下（2026-09 时点有效）：

1. 登录 <https://dash.cloudflare.com>，左侧栏 **Compute (Workers) → Workers & Pages**
   （旧版就是 **Workers & Pages**）
2. 右上 **Create** → 选 **Start with Hello World!** → **Get started**
   ⚠️ 别选 "Import a repository" / "Connect to Git" —— 那条路**没有代码编辑器**
3. 起个名字（如 `ocean-site-counter`）→ **Deploy**
4. 部署完点 **Continue to project** 进入 Worker 页面，
   右上角 **Edit code** 就是编辑器（某些版本叫 **Quick edit**，也可能收在部署卡片的
   `⋯` 菜单里）→ 全选删掉模板代码 → 粘贴 `counter/worker.js` → **Deploy**
5. **Settings → Variables and Secrets → Add**：
   - **KV Namespace binding**：变量名必须叫 `COUNTER`，选第 2 步建的命名空间
   - **Secret**：`SALT_SECRET`，值填一串自己的随机字符

   每加一项都要 **Deploy** 一次才会生效
6. 地址形如 `https://ocean-site-counter.<你的子域>.workers.dev`

> 找不到 **Edit code** 的常见原因：① 走了 Git 连接的部署方式（无编辑器）；
> ② 停在 Deployments 标签页没点进 project；③ 账号还没注册 workers.dev 子域。

## 部署方式 C：wrangler CLI

```bash
cd counter
npx wrangler login                       # 首次会打开浏览器做 OAuth
npx wrangler kv namespace create COUNTER # 把输出的 id 填进 wrangler.toml
npx wrangler deploy
```

`wrangler.toml` 里的 `SALT_SECRET` 记得改成自己的随机串。

## 验证部署成功

```bash
BASE=https://ocean-site-counter.<你的子域>.workers.dev

curl -s $BASE/                                   # 应返回一份 JSON 说明
curl -s -X POST $BASE/hit                        # 记一次访问
curl -s $BASE/stats                              # 应看到 pv 增长
```

浏览器直接打开 `$BASE/` 也能看到说明页。

## 启用前端展示

把地址填进 `assets/js/counter.js` 顶部的 `ENDPOINT`：

```js
var ENDPOINT = 'https://ocean-site-counter.<你的子域>.workers.dev';
```

然后**必须**跑一次资源版本号，否则老访客会吃到缓存的旧脚本：

```bash
python .dev/stamp_assets.py
```

改完之后推送即可。

> **未启用时的行为**：`ENDPOINT` 留空时，`counter.js` 在第一行就 `return`，
> 不发任何网络请求；页脚那块统计区（数字 + 隐私说明）整块带 `hidden`，
> 高度为 0。也就是说在你启用之前，站点的外观与行为与未安装统计时**完全一致**。
> 这一点有线上探针守着：`python .dev/probe_live_counter.py`。

> **覆盖范围**：所有引用了 `counter.js` 的页面都会计一次访问；
> 只有带 `[data-visits]` 展示位的页面（目前是首页）才渲染数字。
> 博客列表页与文章页只计数、不显示。
> `notes/` 下三份收编讲义是自带样式的独立文档，未接入统计。

## 自检

三个脚本，改完统计相关代码后都跑一遍：

```bash
python  .dev/check_counter.py       # 静态隐私审计：9 条红线，读 worker.js 源码
node    .dev/test_worker.mjs        # 逻辑测试：25 条，用假 KV 跑 worker 真实分支
python  .dev/probe_live_counter.py  # 线上探针：17 条，验「未启用 = 零可见影响 + 零请求」
```

`check_counter.py` 会把「`wrangler.toml` 占位值未替换」按预期状态处理（显示为 `--`），
所以**未部署时也应当是 9/9 通过**。

## 已知局限

- **计数是近似的**：KV 没有原子自增，`bump()` 的读-改-写之间存在竞争。
  个人站点量级下误差可忽略；量大了之后把 `bump` 换成 Durable Object 即可。
- **计数可以被刷**：`/hit` 只靠 CORS 限制来源，而 CORS 是浏览器行为，
  用 curl 可以绕过。个人站点通常不值得为此加验证码。
- **「独立访客」是按日去重后累加**：同一个人连续来 10 天会计成 10。
  它衡量的是「不同人·天」，不是自然人数量。
- **城市键超过 1000 个时** KV 的 `list` 需要分页，届时改成只维护 top N。
- **`request.cf.city` 的中文名**由 Cloudflare 给出（如 `Chengdu` 是英文）。
  想显示中文城市名，需要在 `/stats` 里加一层映射。

## 想扩展时

- **近 7 日趋势**：在 `handleHit` 里加 `await bump(env, 'pv:' + utcDay())`，
  在 `/stats` 里循环读最近 7 天即可。
- **只统计中国城市的显示名**：`/stats` 返回的 `country` 目前未在页面上使用，
  需要按国家分组展示时用它。
