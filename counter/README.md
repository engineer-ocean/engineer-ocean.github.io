# 站点访客统计（Cloudflare Worker + KV）

首页页脚那句「本站访问 N 次 · 独立访客 M 位 · 来自 K 个城市」的数据来源。

选择自建而不是挂第三方计数器，主要是为了**数据自有**和**控制收集范围**：
第三方脚本会在你的访客身上加载别人的代码，而你无法审计它到底收走了什么。

## 收集什么 / 不收集什么

| 收集 | 存放位置 | 用途 |
|---|---|---|
| 总访问量 | KV `pv` | 页面显示 |
| 独立访客（按日去重后累加） | KV `uv:total` | 页面显示 |
| 城市级计数 | KV `cityAgg`（一个 JSON 对象，键是 `<国家>\|<城市>`） | 页面显示 |
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

### 怎么拿 token

打开 **<https://dash.cloudflare.com/profile/api-tokens>**（或左侧栏 `My Profile → API Tokens`）：

1. **Create Token**
2. 选最下面的 **Create Custom Token**（不要用上面的模板，见下方说明）
3. 起个名，比如 `ocean-site-counter deploy`
4. **Permissions** 里加**两行**，逐字对上：

   | Permission | Resource | Access |
   |---|---|---|
   | `Workers Scripts` | Account · 你的账号 | Edit |
   | `Workers KV Storage` | Account · 你的账号 | Edit |

5. **Continue to summary → Create Token**
6. **立刻复制** —— 这串只显示一次，关掉就再也看不到

> **为什么不用上面那个 `Edit Cloudflare Workers` 模板？**
> 那个模板还带一条 **Zone 级** 的 `Workers Routes: Write`，绑定路由用的。
> 我们的 Worker 走 workers.dev 子域、**不挂在你自己的域名上**，
> 而你账号里很可能压根没有 zone —— 勾了它要么选不出资源、要么白白扩大 token 的爆炸半径。
> 自定义 token 两条就够了。

> **token 字符串以 `cf_` 或一长串随机字符开头**，是账号级的，不是 API Key。
> 别把 API Key（旧的 Global API Key）当成它用 —— 权限模型完全不同。

### 先预检，再部署

最容易犯的错是**两条权限只勾了一条**，而那时 Cloudflare 只回一句
`[10000] Authentication error`，完全看不出少了什么。所以先跑预检：

```bash
python .dev/deploy_counter.py --token <CF_API_TOKEN> --check-token
```

它会逐条试读并指名道姓地报出来：

```
权限预检（只读，不改任何东西）
  OK   Workers KV Storage · Edit      （建/复用 KV 命名空间）
  OK   Workers Scripts · Edit         （上传 worker.js）
  OK   workers.dev 子域已注册          （xxxx.workers.dev）
```

缺权限的话会直接告诉你**缺哪一条**，并且：
**去同一个页面「编辑」这个 token 补上即可，不用重新生成 —— 改完立即生效，token 字符串不变。**

预检通过后，正式部署：

```bash
python .dev/deploy_counter.py --token <CF_API_TOKEN> --enable-frontend
```

脚本会做的事：

1. 校验 token → 列账号（只有一个就自动选，多个要 `--account <id>`）
2. 建 KV 命名空间 `ocean-site-counter`（已存在则复用，不会重复建）
3. 上传 `worker.js`（ES module，绑定名 `COUNTER`）
4. 写 `SALT_SECRET` —— 走 **encrypted secret** 接口，不落 `plain_text`，
   控制台里也回读不到；不传 `--salt` 就自动随机生成
5. 打开 workers.dev 路由，打印 `https://ocean-site-counter.<子域>.workers.dev`
6. 冒烟测试 `/` → `POST /hit` → `/stats`，确认计数真的涨
7. 加了 `--enable-frontend` 就会把地址填进 `assets/js/counter.js` 并刷新版本号
8. 把部署结果（账号 / KV id / Worker 地址）写进 `.dev/_counter_deploy.json`，
   供 `check_counter.py` 判断部署是否真的完成

先空跑确认无误：`--dry-run`。

> **如果卡在 `[6/7] 该账号还没注册 workers.dev 子域`**：这是账号级的**一次性**设置，
> API 建不了。去 `Workers & Pages` 首页点一下 “Choose your subdomain”，
> 填一个名字后重跑脚本即可（前几步会复用，不会重复建）。

> **token 用完就删。** 部署是一次性动作，删掉最干净；
> 留着的话建议在创建时把 TTL 设短（比如 1 天）。

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
python  .dev/check_counter.py       # 静态隐私审计：读 worker.js 源码
node    .dev/test_worker.mjs        # 逻辑测试：25 条，用假 KV 跑 worker 真实分支
python  .dev/probe_live_counter.py  # 线上探针：15 条，验「未启用 = 零可见影响 + 零请求」
CF_TOKEN=xxx node .dev/diag_stats.mjs  # 拉生产 KV 灌进 worker，看线上 /stats 到底返回什么
```

`diag_stats.mjs` 专门用来**区分「worker 逻辑有 bug」和「前端/时序问题」** ——
本机网络到不了 `*.workers.dev`（见下方排错），但 KV 能通过 REST API 读到，
于是把真实数据灌进假 KV 调 worker 的 `fetch()`，就能确定线上会返回什么。
改完 `handleStats` 之类的读取逻辑后值得跑一次。

`check_counter.py` 用 `.dev/_counter_deploy.json` 判断部署是否真的完成 ——
这份记录由 `deploy_counter.py` 每次部署后自动落盘，比看 `wrangler.toml` 准：
**走 REST API 部署时 toml 里的占位值永远是原样，那不是「没部署」。**
所以未部署时应当是 9/9 通过（部署记录那条会被跳过），部署完成后是 10/10。

## 已知局限

- **计数是近似的**：KV 没有原子自增，`bump()` 的读-改-写之间存在竞争。
  个人站点量级下误差可忽略；量大了之后把 `bump` 换成 Durable Object 即可。
- **计数可以被刷**：`/hit` 只靠 CORS 限制来源，而 CORS 是浏览器行为，
  用 curl 可以绕过。个人站点通常不值得为此加验证码。
- **「独立访客」是按日去重后累加**：同一个人连续来 10 天会计成 10。
  它衡量的是「不同人·天」，不是自然人数量。
- **城市表是一个 JSON 值，读-改-写有竞争**：`cityAgg` 整张表一次读一次写，
  并发命中时两次写入会互相覆盖（个人站点量级可忽略）。
  换来的是**强一致**：`/stats` 只走 `get()`，绝不会出现「刚写进去却读不到」。
  早期版本按城市分散成 `city:<国家>|<城市>` 键、再用 `list({prefix})` 汇总，
  于是稳定复现了「来自 0 个城市」—— 成因见下方排错一节。
- **`request.cf.city` 的中文名**由 Cloudflare 给出（如 `Chengdu` 是英文）。
  想显示中文城市名，需要在 `/stats` 里加一层映射。

## 想扩展时

- **近 7 日趋势**：在 `handleHit` 里加 `await bump(env, 'pv:' + utcDay())`，
  在 `/stats` 里循环读最近 7 天即可。
- **只统计中国城市的显示名**：`/stats` 返回的 `country` 目前未在页面上使用，
  需要按国家分组展示时用它。

## 排错

### 本机连不上 `*.workers.dev`

现象：脚本第 7 步冒烟测试报 `HTTP 0`，或浏览器打不开 Worker 地址。
**这多半不是你的配置问题，是本机 DNS 把它拦了。** 判据：

```bash
nslookup ocean-site-counter.<你的子域>.workers.dev
```

正常应解析到 Cloudflare 的地址（`104.x` / `172.67.x`）。如果解析出的是
**完全无关的 IP**（实测过解析到 Meta 的网段 `2a03:2880:...:face:b00c`，
`face:b00c` 是它标志性的选择），那就是 DNS 劫持/拦截页——
常见于公司网络、部分运营商、以及带域名白名单的沙箱环境。

这时**Worker 本身是好的，只是本机测不了**：

- 用浏览器直接打开 Worker 地址（浏览器常常能通，不走同一套 DNS）
- 或换个网络（手机热点）试
- 部署流程可以加 `--skip-smoke` 跳掉这一步，不影响其余步骤

### 冒烟测试通过但页面上没有数字

按顺序查三处：

1. `counter.js` 里的 `ENDPOINT` 是否等于 Worker 地址（跑 `--enable-frontend` 会自动填）
2. 有没有**跑过 `stamp_assets.py`** —— 没跑的话回访用户吃的是缓存的旧脚本
3. 浏览器控制台有没有 CORS 报错 —— 若你在别的域名下测试，
   要把该来源加进 `worker.js` 的 `ALLOWED_ORIGINS`

### 页面上显示「来自 0 个城市」，但后台看 KV 里明明有数据

这是 KV **`list()` 的缓存**造成的，不是没记上。

同一个键刚 `put()` 进去，`list({prefix})` 往往要**几十秒**后才认得它；
而 `get()` 在**写入的那个机房**是强一致的。于是出现这种自相矛盾的现象：

| 读法 | 刚写完立刻读 | 页面表现 |
|---|---|---|
| `get('pv')` | 立刻看得到 | 总访问量正常增长 |
| `list({prefix:'city:'})` | 要等缓存过期 | 城市数还是 0 |

> **判据**：「总访问量」在涨、只有「城市数」是 0 —— 两者一个走 `get()`、
> 一个走 `list()`，那就一定是这个问题。若两个都不涨，是请求根本没到 Worker。

现在的实现把整张城市表存成单个 JSON 值 `cityAgg`，只走 `get()`/`put()`，
不再依赖 `list()`。首次读到空的 `cityAgg` 时会自动把老的
`city:<国家>|<城市>` 键汇总写回，**老数据不会丢**。

### 想直接确认有没有访问被记下来

不依赖页面，直接问 KV（把 `<ACCOUNT_ID>`、`<KV_ID>`、`<TOKEN>` 换掉）：

```bash
curl -s "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/storage/kv/namespaces/<KV_ID>/keys?per_page=100" \
  -H "Authorization: Bearer <TOKEN>" | python -m json.tool
```

访问过后应该能看到 `pv`、`uv:total`、`cityAgg` 这类键。
空的话就是请求根本没到 Worker。

想确认线上跑的到底是哪一版脚本（排查「本地改了、线上没变」），
可以直接把线上脚本拉下来跟本地逐行对比：

```bash
curl -s "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/workers/scripts/ocean-site-counter" \
  -H "Authorization: Bearer <TOKEN>"      # 返回 multipart，里面那段就是线上 worker.js
```

注意 `/content` 那个端点对 API token 会回 `10405 Method not allowed`，
上面这个不带 `/content` 的路径才能拿到（返回 `multipart/form-data`）。
