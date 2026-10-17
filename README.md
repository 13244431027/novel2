# 在线书城 · 多源小说阅读

基于 Legado 书源 `qimao.json`（七猫小说）与 `qidian.json`（起点），并内置红袖读书、飞卢小说、独步小说网、酷我小说网页 / API 源打造的纯前端 + 轻量 Node 服务的在线阅读网站，支持在顶栏切换书源。
零第三方依赖，单个 Node 进程同时提供 API 与静态资源。

## 功能

- **多书源切换**：顶栏下拉选择书源（七猫 / 红袖读书 / 飞卢小说 / 独步小说网 / 酷我小说 / 起点），切换后首页频道、分类、搜索与书籍数据同步切换
- **书城首页**：男生 / 女生 / 出版图书（七猫），男生 / 女生分类与完本（红袖读书），全部分类（飞卢小说），全部分类（独步小说网），男频 / 女频榜单与分类（起点）;酷我小说无分类浏览端点，切换后经顶部搜索找书
- **搜索**：按书名 / 作者搜索，分页
- **书籍详情**：封面、简介、标签、完本状态、字数、最新章节，支持加入书架
- **阅读器**：AES-128-CBC 解密的章节正文，上一章 / 下一章、键盘左右键翻页、目录抽屉（章节名筛选）
- **工具栏显隐**：点击正文空白处隐藏或显示顶栏 / 底栏按钮，Esc 键也可唤出
- **纯阅读模式**：在阅读设置中开启后，进入阅读器自动隐藏全部工具栏，专注正文，轻点屏幕即可临时唤出
- **阅读设置**：字号、行距、字间距、段间距、字体（宋体 / 黑体 / 楷体）、内容宽度（窄 / 中 / 宽）、首行缩进开关、九种纸张背景、纯阅读模式开关、一键恢复默认
- **设置范围**：排版类设置（字体 / 字号 / 行距 / 间距 / 宽度 / 缩进）全局生效，背景色按书独立记忆
- **书架与阅读记录**：基于 localStorage，最多 200 本藏书、40 条阅读记录、每章滚动位置
- **深色模式**：整站主题切换
- **移动端适配**：响应式布局

## 运行

```bash
# 安装：无需 npm install，仅依赖 Node >= 18 内置模块
PORT=3000 node server.js

# 或使用 package.json 脚本
npm start
```

打开 http://localhost:3000 即可使用。

## 目录结构

```
qimao.json          Legado 书源（七猫小说：搜索 / 分类 / 详情 / 目录 / 正文规则）
qidian.json         Legado 书源（起点：搜索 / 榜单 / 分类 / 详情 / 目录 / 正文规则）
server.js           Node HTTP 服务：/api/* 接口 + public/ 静态资源
src/booksource.js   书源注册与频道分类配置（七猫 + 红袖 + 飞卢 + 独步 + 酷我 + 起点）
src/qimao.js        七猫 API 客户端：签名、请求重试、缓存、正文 AES 解密
src/qidian.js       起点客户端：移动端 SSR 页面解析、csrf 会话、榜单 / 分类接口
src/hongxiu.js      红袖读书客户端：移动端 HTML 解析、分类 / 完本、详情 JSON、目录 / 正文
src/faloo.js        飞卢小说客户端：GBK 编解码、移动端 HTML 解析、分类、目录 / 正文
src/dbxsd.js        独步小说网客户端：移动端 HTML 解析、分类分页、详情、目录、多页正文聚合
src/kuwo.js         酷我小说客户端：JSON API、搜索 / 详情 / 目录 / 正文、VIP 章节标记
public/index.html    页面骨架
public/styles.css    样式
public/app.js        前端 SPA（hash 路由：#/、#/search、#/book/:id、#/read/:id/:cid、#/shelf）
```

## API 一览

| 路径 | 参数 | 说明 |
| --- | --- | --- |
| `GET /api/config` | `source` | 书源列表、当前书源与首页频道配置 |
| `GET /api/search` | `source`, `wd`, `page` | 搜索书籍 |
| `GET /api/list` | `source`, `kind=rank\|category\|tag`, `id`, `page`, `need` | 榜单 / 分类 / 标签下的书籍列表 |
| `GET /api/book` | `source`, `id` | 书籍详情 |
| `GET /api/chapters` | `source`, `id` | 章节目录 |
| `GET /api/chapter` | `source`, `id`, `chapterId` | 章节正文（七猫为服务端解密后明文） |

书籍 `id` 在接口与前端统一为 `{source}:{id}` 形式，避免多书源间 ID 冲突。

## 实现要点

- **签名**：参数按 key 排序拼接 `k=v` 后追加 `sign_key` 取 MD5；请求头另带一组固定头 + 头签名
- **正文解密**：七猫正文 base64 解码后前 16 字节为 IV，其余为 AES-128-CBC 密文（密钥 `242ccb8230d709e1` 的 hex 形式），Pkcs7 填充
- **起点接入**：搜索 / 详情 / 目录 / 正文来自 `m.qidian.com` 的 `vite-plugin-ssr_pageContext` SSR JSON；榜单与分类来自 `wxapp.qidian.com` 接口，需先请求搜索页获取 `_csrfToken` cookie 建立会话
- **红袖接入**：`m.hongxiu.com` 移动端 HTML，搜索 / 分类 / 目录 / 正文为普通页面，详情页从内联 `g_data.book` JSON 取字段；分类路径含排序参数（`id` 形如 `{分类ID}:{排序}`）
- **飞卢接入**：`wap.faloo.com` 为 GBK 编码，内置 GBK 编解码（搜索关键词需按 GBK 转义），搜索 / 分类 / 详情 / 目录 / 正文均走移动端页面解析；分类 `id` 形如 `{分类ID}:{排序}`
- **独步接入**：`www.dbxsd.com` 移动端 HTML，分类 / 详情 / 目录 / 正文均为普通页面，全站免费；书籍 `id` 为路径 slug（如 `douluodalu`、`p27428`，非纯数字），正文支持按 `{cid}_{n}.html` 多页聚合；分类分页为窗口式导航，`totalPages` 取当前页可见的最大页码
- **酷我接入**：`appi.kuwo.cn` 原生 JSON API（Android 客户端 UA），搜索 / 详情 / 目录 / 正文全 JSON，正文接口对 VIP 章节直接返回全文（源自身行为，不作绕过判定），目录按 `vip_flag` 自动打 `VIP` 标；无分类浏览端点，作为纯搜索 + 阅读源
- **书源解析**：`qimao.json` 内含非法 JSON 转义（如 `\s`），无法直接 `JSON.parse`，改为按文本读取并用正则提取所需字段
- **缓存**：服务端内存缓存（详情 10 分钟、目录 30 分钟、正文 1 小时，上限 600 条 LRU 淘汰，并发请求合并）；静态资源带 ETag 与内存缓存，文本响应启用 gzip 压缩
- **传输优化**：gzip 压缩文本 / JSON（约 75% 体积削减），ETag 命中时返回 304 空响应，HEAD 请求不返回正文
- **安全**：静态文件路径穿越防护、非法 URI 编码返回 400、非 GET 请求返回 405、`X-Content-Type-Options: nosniff`

## 说明

- 封面图分别来自七猫 CDN（`cdn.wtzw.com`）、红袖 CDN（`bookcover.yuewen.com`）、飞卢 CDN（`img.faloo.com`）、独步 `www.dbxsd.com` 与起点 CDN，通过 `referrerpolicy="no-referrer"` 引用
- 书源中的 `application-id` 为脱敏值 `com.****.reader`，可正常访问上游接口
- 起点 / 红袖 / 飞卢书源的 VIP / 受限章节不作绕过，仅支持公开章节阅读（飞卢 VIP 章节较多，可阅读其免费章节）
- 独步（全站免费）与酷我（VIP 章节接口直接返回全文，其 API 自身行为）无需绕过即可读全文
- 起点 SSR 对 VIP 章节仅返回约 100 字预览，已通过章节 `vipStatus` / `price` / 字数比例检测截断预览并提示受限，避免正文"显示不全"
- **VIP 自动标记**：目录接口自动检测各书源 VIP 章节并在列表中打 `VIP` 标——起点按目录 `sS`（0 收费 / 1 免费）、红袖按章节 `chapter-li-a` 的 `unpay` 类、飞卢按所在卷的 `icon_vip` 标记、酷我按目录 `vip_flag` 标记、七猫与独步全站免费均标记为免费；点击 VIP 章节时正文接口返回受限提示
- 红袖与飞卢的分类 `id` 为 `{分类ID}:{排序}` 字符串（非纯数字），七猫分类 / 标签 `id` 为纯数字，独步分类 `id` 为短英文字符串（如 `xh-qh`）、书籍 `id` 为 slug（如 `douluodalu`）
- 阅读记录、书架、设置均保存在浏览器 localStorage，清空浏览器数据会丢失
