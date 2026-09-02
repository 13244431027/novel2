# User Instruction Memory

This file records user instructions, preferences, and teachings for reference in future interactions.

## Format

### User Instruction Entry
User instruction entries should follow this format:

[User Instruction Summary]
- Date: [YYYY-MM-DD]
- Context: [Mentioned scenario or time]
- Instructions:
  - [Content of user teaching or instruction, described line by line]

### Project Knowledge Entry
Entries discovered by the Agent during task execution should follow this format:

[Project Knowledge Summary]
- Date: [YYYY-MM-DD]
- Context: Discovered by Agent while performing [specific task description]
- Category: [Operations & Deployment|Build Methods|Testing Methods|Troubleshooting & Debugging|Workflow & Collaboration|Environment Configuration]
- Instructions:
  - [Specific knowledge points, described line by line]

## Deduplication Strategy
- Before adding a new entry, check for similar or identical instructions.
- If a duplicate is found, skip the new entry or merge it with the existing one.
- When merging, update the context or date information.
- This helps avoid redundant entries and keeps the memory file tidy.

## Entries

[Project Knowledge Summary]
- Date: 2026-09-01
- Context: Discovered by Agent while reverse-engineering the 七猫小说 book source (`/workspace/qimao.json`) to build a novel-reading website
- Category: Troubleshooting & Debugging
- Instructions:
  - 七猫 API 签名：Header `sign` 和 Param `sign` 均为 `md5(排序后的 k=v 拼接 + sign_key)`，sign_key=`d3dGiJc651gSQ8w1`
  - 固定 Headers：`app-version=51110, platform=android, reg=0, AUTHORIZATION='', application-id=com.****.reader, net-env=1, channel=unknown, qm-params=''`
  - 章节内容接口 `/api/v1/chapter/content` 的参数是 `id` + `chapterId`（`book_id`/`chapter_id` 会返回参数错误 44010102）
  - 章节内容解密：content 为 base64，前 16 字节是 IV，剩余部分是 AES-128-CBC 加密（key=ASCII `242ccb8230d709e1`，PKCS7）
  - 章节列表接口 `/api/v1/chapter/chapter-list` 用 APP 签名 + `id` 参数即可获取目录（H5 的 native_encrypt 签名不可复现）
  - 搜索接口 `/api/v5/search/words`，参数 `gender=3, imei_ip=2937357107, page, wd`
  - 详情接口 `/api/v4/book/detail`，参数 `id, imei_ip=2937357107, teeny_mode=0`，返回 `data.book`
  - 章节 ID 连续递增（如斗罗大陆 first=17059214620001），可用于枚举目录
  - 错误码：44010102=参数错误，44010120=验签失败，12010101=书籍已下架
