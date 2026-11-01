# 在线书城 · 多源小说阅读

基于 Legado 书源 `qimao.json`（七猫小说）与内置手机小说 / 笔趣阁网页源打造的纯前端 + 轻量 Node 服务的在线阅读网站，支持在顶栏切换书源。仅提供全站免费书源，不含付费章节。
零第三方依赖，单个 Node 进程同时提供 API 与静态资源。

## 功能

- **多书源切换**：顶栏下拉选择书源（七猫 / 手机小说 / 笔趣阁 / 笔趣阁(bqgz.cc)），切换后首页频道、分类、搜索与书籍数据同步切换
- **书城首页**：男生 / 女生 / 出版图书（七猫），分类 / 排行（手机小说），全部分类（笔趣阁 / 笔趣阁(bqgz.cc)）
- **搜索**：按书名 / 作者搜索，分页
- **书籍详情**：封面、简介、标签、完本状态、字数、最新章节，支持加入书架
- **阅读器**：AES-128-CBC 解密的章节正文，上一章 / 下一章、键盘左右键翻页、目录抽屉（章节名筛选）
- **工具栏显隐**：点击正文空白处隐藏或显示顶栏 / 底栏按钮，Esc 键也可唤出
- **纯阅读模式**：在阅读设置中开启后，进入阅读器自动隐藏全部工具栏，专注正文，轻点屏幕即可临时唤出
- **阅读设置**：字号、行距、字间距、段间距、字体（宋体 / 黑体 / 楷体 / 仿宋 / 圆体 / 微软雅黑 / 思源宋体）、内容宽度（窄 / 中 / 宽）、首行缩进开关、九种纸张背景、纯阅读模式开关、一键恢复默认
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
server.js           Node HTTP 服务：/api/* 接口 + public/ 静态资源
src/booksource.js   书源注册与频道分类配置（七猫 + 手机小说 + 笔趣阁 + 笔趣阁(bqgz.cc)）
src/qimao.js        七猫 API 客户端：签名、请求重试、缓存、正文 AES 解密
src/shoujixs.js     手机小说客户端：移动端 HTML 解析、Post 搜索、分类 / 排行、详情、目录、多页正文聚合
src/byqg.js         笔趣阁客户端：HTML 解析、搜索、分类、详情、分页目录、正文
src/bqgz.js         笔趣阁(bqgz.cc) 客户端：桌面端 HTML 解析、搜索、详情、目录、正文
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
- **手机小说接入**：`wap.shoujixs.net` 移动端 HTML，搜索为 POST 表单（关键词最少 4 个汉字）、分类 / 周月总榜 / 全本列表按 `{key}_{page}.html` 分页，详情取 `og:novel:*` meta 字段，正文支持按 `{cid}_{n}.html` 多页聚合（以「下一页」分页按钮判据）；封面来自 `images.shoujixs.net`
- **笔趣阁接入**：`www.byqg.cc` 桌面端 HTML，搜索 / 分类 / 详情 / 目录 / 正文均为普通页面，全站免费；书籍 `id` 与章节 `id` 均为非数字 abbr（如 `3dQsiGuULpsUwgVAoJqihT` / `55TRsZ9gJ2DyWcrr2RK3nF`）；目录每页 500 章以「下一页」翻页，详情字数形如 `536.0万字` 会换算
- **笔趣阁(bqgz.cc) 接入**：`www.bqgz.cc` 桌面端 HTML，搜索 / 详情 / 目录 / 正文均为普通页面，全站免费；目录页以 `dirlist` 为起点切片并限定本书 id，避免把「最新章节」区混入目录；书籍与章节 `id` 均为纯数字；封面图原站指向 `www.pansosou.cn`，已重定向到本站域名以便封面代理
- **书源解析**：`qimao.json` 内含非法 JSON 转义（如 `\s`），无法直接 `JSON.parse`，改为按文本读取并用正则提取所需字段
- **缓存**：服务端内存缓存（详情 10 分钟、目录 30 分钟、正文 1 小时，上限 600 条 LRU 淘汰，并发请求合并）；静态资源带 ETag 与内存缓存，文本响应启用 gzip 压缩
- **传输优化**：gzip 压缩文本 / JSON（约 75% 体积削减），ETag 命中时返回 304 空响应，HEAD 请求不返回正文
- **安全**：静态文件路径穿越防护、非法 URI 编码返回 400、非 GET 请求返回 405、`X-Content-Type-Options: nosniff`

## 说明

- 封面图分别来自七猫 CDN（`cdn.wtzw.com`）、手机小说 `images.shoujixs.net` 与笔趣阁(bqgz.cc)（经本站域名中转），通过 `referrerpolicy="no-referrer"` 引用；封面代理仅放行白名单域名
- 书源中的 `application-id` 为脱敏值 `com.****.reader`，可正常访问上游接口
- 七猫 / 手机小说 / 笔趣阁均为全站免费书源，不含 VIP / 付费章节
- 七猫分类 / 标签 `id` 为纯数字，手机小说书籍 / 章节 `id` 为纯数字，笔趣阁书籍 / 章节 `id` 为非数字短码
- 阅读记录、书架、设置均保存在浏览器 localStorage，清空浏览器数据会丢失
