# engineer-ocean.github.io

个人站点源码。纯静态，无构建步骤、无外部依赖 —— GitHub Pages 直接从仓库根目录发布。

线上地址：**https://engineer-ocean.github.io/**

## 目录结构

```
.
├── index.html                 首页（关于 / 方向 / 经历 / 领域知识 / 笔记 / 联系）
├── 404.html                   404 页面
├── blog/
│   ├── index.html             技术笔记列表（含标签筛选）
│   └── posts/                 文章正文
│       ├── gls-x-propagation.html
│       ├── sdf-sta-consistency.html
│       └── gls-profiling-notes.html
├── notes/
│   ├── eda-knowledge-map/     数字前端验证工具研发 · 领域知识地图（单文件自包含）
│   │   └── index.html
│   ├── vlsi2/                 VLSI 2 中文课堂讲义（自包含页面 + 160 张配图）
│   │   ├── index.html
│   │   └── img/
│   ├── formal-verification/   《形式验证》第二版中文译本（单文件、图片全内联）
│   │   └── index.html
│   └── systemverilog-1800-2023/  《IEEE 1800-2023 SystemVerilog 标准》中文译本
│       └── index.html            （单文件 14 MB、286 张图全内联、41 章）
├── assets/
│   ├── css/style.css          设计系统（全部样式，含明暗双主题）
│   ├── js/main.js             交互（主题切换、移动端菜单、标签筛选）
│   └── img/favicon.svg        站点图标
├── robots.txt
├── sitemap.xml
└── .nojekyll                  跳过 Jekyll 处理，加快构建
```

## 设计约定

- **配色**：以 CSS 变量集中定义在 `assets/css/style.css` 顶部的 `:root` 与
  `[data-theme="dark"]` 两个块里。改主题色只需改 `--accent`（浅色）与 `--accent`（深色）。
- **主题切换**：`localStorage` 键名 `yy-theme`；未设置时跟随系统 `prefers-color-scheme`。
  每个页面 `<head>` 里有一段内联脚本在首次绘制前设定 `data-theme`，避免闪白 ——
  新增页面时记得带上它。
- **字体**：系统字体栈，中文优先 PingFang SC / 微软雅黑；等宽用于标签与元信息。
- **路径**：全部使用站点根路径（`/assets/...`、`/blog/...`），
  因为这是用户站点（`<username>.github.io`），部署在域名根目录下。

## 新增一篇文章

1. 复制 `blog/posts/gls-profiling-notes.html` 作为模板。
2. 修改 `<title>`、`<meta name="description">`、`<link rel="canonical">`、
   `<h1>`、`.article-desc`、`.article-bar` 里的日期与标签。
3. 正文写在 `<div class="prose">` 里。可用元素：
   `h2` / `h3` / `p` / `ul` / `ol` / `blockquote` / `table` / `pre > code` / `hr`。
4. 在 `blog/index.html` 的 `<ul class="post-list">` 里加一条
   `<li class="post-item" data-tags="标签A 标签B">`（标签用空格分隔，**标签名内不要有空格**，
   否则筛选会失效）。
5. 在首页 `index.html` 的「技术笔记」段落同步最新的三条，并在 `sitemap.xml` 里补一条 URL。

## 本地预览

```bash
python -m http.server 8000
# 打开 http://localhost:8000
```

直接用 `file://` 打开会失效 —— 页面使用根路径引用资源，必须经由 HTTP 服务访问。

## 部署

推送到 `main` 分支即自动发布，通常 1 分钟内生效。

## 内容口径

公开内容对现雇主信息做了模糊化处理（不出现公司全称、项目内部代号、具体数据）。
修改内容时请保持这一口径。

- 现雇主写「国产 EDA 公司数字仿真器项目组」，**不出现公司全称**
- 前雇主写「国内头部芯片公司数字验证工具部」，同样**不出现公司全称**（类指表述是刻意的）
- `emu` 为工具链通用缩写，可保留；`ArkCompiler` 为开源项目名，可保留
- 公开的产品方向表述为 **SoC 验证 / 逻辑仿真 / X 态语义**；
  「逻辑仿真器」指数字逻辑仿真器但比「数字 EDA 仿真器」更聚焦，对外统一用前者

### 公开身份（重要）

站点以 **Ocean**（`engineer-ocean`）这一身份对外，**不出现任何旧账号信息**：

- 展示名统一写 `Ocean`，品牌标记 `EO`，**不要**写回其他名字
- 站内**不得**出现任何指向旧账号的链接、`@handle` 文本或域名
- 对外入口只有本站、`yyang16@126.com`、`/notes/vlsi2/`、
  `/notes/formal-verification/`、`/notes/systemverilog-1800-2023/`
- 新增页面时，`<title>` 后缀、页脚版权、导航 brand 都要用 `Ocean`

改动后跑一次自查，**应无输出**。它扫描**所有文件类型** —— 不只是 HTML：
CSS / JS / SVG 的注释与 `aria-label` 里同样容易残留旧名字（本站在迁移时就漏过一轮）。
把 `PAST` 换成旧账号名，只在本机执行，**不要把它写进仓库**：

```bash
PAST=旧账号名 python - <<'PY'
import os
from pathlib import Path

past = os.environ["PAST"]
for p in Path('.').rglob('*'):
    if not p.is_file() or any(x in p.parts for x in ('.dev', '.workbuddy', '.git')):
        continue
    try:
        text = p.read_text(encoding='utf-8')
    except Exception:
        continue
    for i, line in enumerate(text.splitlines(), 1):
        if past in line:
            print(f'{p}:{i}: {line.strip()[:80]}')
PY
```
