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

## 部署方式 A：Cloudflare 控制台（推荐，无需本地工具）

1. 登录 <https://dash.cloudflare.com>（没有账号就注册，免费额度足够）
2. **Storage & Databases → KV → Create namespace**，名字填 `ocean-site-counter`
3. **Compute (Workers) → Create → 从 Hello World 模板开始**，
   Worker 名字也填 `ocean-site-counter`
4. **Edit code**，把 `worker.js` 全文粘贴进去，**Deploy**
5. **Settings → Variables and Secrets** 加两项：
   - **KV Namespace binding**：变量名必须是 `COUNTER`，选中第 2 步建的命名空间
   - **Text variable**：`SALT_SECRET`，值填一串你自己的随机字符
6. 再 **Deploy** 一次，拿到形如
   `https://ocean-site-counter.<你的子域>.workers.dev` 的地址

## 部署方式 B：wrangler CLI

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

> `ENDPOINT` 留空时，`counter.js` 完全不发任何网络请求 ——
> 也就是说在你启用之前，站点行为与未安装统计时完全一致。

## 已知局限

- **计数是近似的**：KV 没有原子自增，`bump()` 的读-改-写之间存在竞争。
  个人站点量级下误差可忽略；量大了之后把 `bump` 换成 Durable Object 即可。
- **计数可以被刷**：`/hit` 只靠 CORS 限制来源，而 CORS 是浏览器行为，
  用 curl 可以绕过。个人站点通常不值得为此加验证码。
- **城市键超过 1000 个时** KV 的 `list` 需要分页，届时改成只维护 top N。

## 想扩展时

- **近 7 日趋势**：在 `handleHit` 里加 `await bump(env, 'pv:' + utcDay())`，
  在 `/stats` 里循环读最近 7 天即可。
- **只统计中国城市的显示名**：`/stats` 返回的 `country` 目前未在页面上使用，
  需要按国家分组展示时用它。
