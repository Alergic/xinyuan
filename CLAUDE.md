# 心愿计划 — 项目上下文

> 最后更新：2026-06-17（第六轮：5.1 功能完善 + 详情页优化 + Bug 修复）

## 项目简介

## 项目简介

心愿计划是一款微信小程序，帮助用户记录想买的物品、追踪价格变化、管理存款进度，并在合适时间理性完成购买。

- **平台**：微信小程序 + 云开发
- **基础库**：3.12.1
- **云开发环境**：按量计费（需配置 env ID）

---

## 1. 关键决策记录

### 1.1 架构决策

| 决策 | 结论 | 原因 |
|------|------|------|
| 云函数公共模块 | `cloudfunctions/common/index.js` 提供统一工具 | 消除 6 个云函数间的代码重复，统一错误处理、分页、所有权校验 |
| 页面数据加载 | `miniprogram/utils/dataLoader.js` 的 `Loader` 类 | 替代脆弱的 `Promise.all`，支持依赖声明和独立错误处理 |
| WXML 格式化 | WXS 模块 (`util.wxs`)，而非 Page 方法 | Page 方法在 WXML 中调用不可靠，会静默失败导致空白 |
| 列表数据充实 | 云函数端 `listEnriched` action | 消除客户端 N+1 查询（原每 item 发 2 次云函数调用） |
| Pool 功能归属 | 合并到 `saving` 云函数 | 无需单独 pool 云函数（空目录已存在但无用） |
| 存款删除策略 | saving 云函数 `deleteRecord` + `deallocate` | 专项存款直接删除；通用池分配撤销后资金退回通用池 |
| 列表展示用状态 | `display_status` 客户端计算，不修改原始 `status` | 逾期/可购买是派生状态，不应持久化到数据库 |
| 预计算原则 | WXML 中只放简单绑定，复杂值在 JS 预计算 | WXML 不支持 `.toFixed()`、嵌套三元等 JS 表达式 |
| 状态管理统一入口 | 详情页状态标签点击 → ActionSheet 切换 | 替代多个独立按钮，提供恢复路径（暂缓/放弃 → 计划中） |
| 统计计数逻辑 | 云函数端与客户端 `display_status` 保持一致 | 避免 stats 页显示 0（原直接查 DB `status: 'saving'` 永远为空） |
| 多图存储 | `image_urls` 数组 + `image_url`（首图兼容） | 兼容旧单图数据，新增页用 3 图网格 |
| 备注采集 | 价格/存款弹窗两步式（金额 → 备注） | 微信小程序一次只能弹一个输入框，两步是权衡方案 |
| pool_allocation 查询 | 通过云函数 `listAllocations` 而非客户端直查 | 客户端直查受集合权限/索引限制，可能静默返回空 |
| 定期存入计划存储 | 独立集合 `auto_save_plan`，非 wishlist_item 字段 | 分离关注点；upsert 模式同一心愿只保留一条；软停用保留历史 |
| 定期存入执行 | 手动触发 executeAutoSave，非定时触发器 | V1 保持简单，手动触发可感知；定时触发器延后实现 |

### 1.2 已修复的关键 Bug

| Bug | 根因 | 修复 |
|-----|------|------|
| wishlist `list` 崩溃 | `orderBy({updated_at: -1})` 对象格式非法 | `orderBy('updated_at', 'desc')` |
| 所有价格显示空白 | WXML 中 `{{formatMoney()}}` 调用 Page 方法静默失败 | WXS `util.formatMoney()` |
| 首页不显示数据 | `Promise.all` 单点故障 | 独立 try-catch |
| task toggle/delete 崩溃 | 不存在的文档访问 `undefined.data` | `requireOwnership()` |
| 余额/统计超出 100 条失真 | `.get()` 默认 100 条截断 | `fetchAll()` 自动分页 |
| category update/delete 越权 | 不校验所有权 | `requireOwnership()` |
| detail 页竞争条件 | `loadSavings` 和 `loadItem` 并行 | `Loader` 声明依赖 |
| wishlist 页 N+1 | `enrichItems` 每 item 2 次云函数调用 | 云函数端 `listEnriched` 批量查询 |
| pool 页余额计算错误 | 依赖并行任务中间状态 | 独立计算，消除竞争 |
| deadline Date 崩溃 | `deadline.substring()` 对 Date 对象 | `util.formatDate()` |
| 已逾期筛选无效 | overdue 是客户端计算状态，直接传给后端查询返回空 | 已逾期筛选时传 `all` 给后端，客户端过滤 |
| 分类名详情页不显示 | `categoryName` 初始化后从未赋值 | `loadItem()` 中根据 `category_id` 查询分类名 |
| 价格历史完全不展示 | `loadPrices()` 获取数据但 WXML 未渲染 | 新增价格历史卡片 |
| 存款记录不可删除 | saving/price 云函数无 delete action | 新增 `deleteRecord`/`deallocate`/`delete` action |
| stats.wxml 编译错误 | WXML 中使用了 `.toFixed()` 和嵌套三元 | JS 预计算 `totalProgress` 和 `progressColor` |
| 统计页"存款中"始终为 0 | DB 中 status 永远是 `planning`，没有 `saving`；saving/buyable 计数重叠 | stats 云函数改为逐 item 计算 display_status，互斥计数 |
| 暂缓/放弃后无法恢复 | 详情页只有独立的状态变更按钮，无恢复入口 | 状态标签改为可点击 → ActionSheet 统一切换，支持恢复为计划中 |
| 优先级标签全为灰色 | wishlist.wxml 用 `tag-priority` 单一灰色类 | 改为 `tag-{{item.priority}}` 复用全局红/橙/蓝紫 |
| 状态改回计划中后列表仍显示可购买 | `display_status` 纯数据驱动，忽略用户显式设置的 DB status | display_status 计算尊重 `planning`/`paused`，不自动升级 |
| 重点心愿卡片重复 | 三个卡片独立选取无去重 | `usedIds` Set 按优先级依次排除 |
| 统计页"可购买"计数不准 | stats 要求 `hasEnough`（100% 存款）才计 buyable，wishlist 无此限制 | 去掉 hasEnough，与 wishlist 一致：价格达标或进度达标即 buyable |
| 统计卡片右侧空白 | `.stat-card` 缺少 `box-sizing: border-box`，padding 撑破宽度 | 加 `box-sizing: border-box` |
| pool_allocation 客户端查不到 | 客户端 SDK 直查 `pool_allocation` 受权限/索引限制，静默返回空 | 新增 `saving.listAllocations` 云函数，所有分配查询走服务端 |
| 分配操作静默失败 | 云函数调用后不检查 `result.code`，失败也 toast 成功 | 所有分配调用加 `code !== 0` 检查 |

### 1.3 技术栈约定

- **所有云函数必须使用** `wrapHandler` 包装主入口
- **所有权校验**统一用 `requireOwnership(collection, docId, openid)`
- **获取全部记录**用 `fetchAll(query)` 替代 `.get()`
- **页面加载多数据源**用 `new Loader(this)` 替代 `Promise.all`
- **WXML 中格式化**用 WXS `util.formatMoney()`，不依赖 Page 方法
- **WXML 中禁止复杂表达式** — `.toFixed()`、嵌套三元等在 JS 中预计算后传入
- **客户端派生状态**用 `display_status`，不污染数据库 `status` 字段
- **金钱操作必须有二次确认**（`util.showConfirm` 在云函数调用前）

---

## 2. 项目结构

```
xinyuan/
├── project.config.json              # 小程序配置（含 AppID）
├── project.private.config.json
├── cloudfunctions/
│   ├── common/
│   │   ├── index.js                 # ★ 公共工具：wrapHandler/fetchAll/requireOwnership/batchCountByField
│   │   └── package.json
│   ├── login/                       # 微信登录（获取 openid）
│   ├── wishlist/                    # 心愿 CRUD + listEnriched
│   ├── saving/                      # 存款管理（含通用池 + deleteRecord + deallocate）
│   ├── price/                       # 价格记录 + 史低价 + delete
│   ├── task/                        # 任务清单（add/toggle/update/delete/list）
│   ├── stats/                       # 数据统计
│   ├── notify/                      # ★ Deadline 订阅消息提醒（定时触发）
│   ├── category/                    # 分类管理
│   └── pool/                        # 空目录，忽略（功能在 saving 中）
├── miniprogram/
│   ├── app.js                       # 入口：云开发初始化，获取 openid
│   ├── app.json                     # 页面注册 + TabBar
│   ├── app.wxss                     # 全局样式
│   ├── images/                      # 图标资源（10 张 TabBar PNG，81x81px）
│   ├── utils/
│   │   ├── util.js                  # JS 工具函数
│   │   ├── util.wxs                 # ★ WXS 模板格式化（formatMoney）
│   │   └── dataLoader.js            # ★ Loader 类（依赖感知数据加载）
│   └── pages/
│       ├── index/                   # 首页：统计总览 + 重点心愿
│       ├── wishlist/                # 心愿列表：筛选/排序/搜索 + 优先级 + 视觉降级
│       ├── add/                     # 添加/编辑心愿
│       ├── detail/                  # 心愿详情：价格历史 + 存款明细 + 删除
│       ├── pool/                    # 通用存款池：存入/分配/撤销
│       ├── savings/                 # 存款记录列表：汇总 + 进度 + 删除
│       ├── stats/                   # 数据统计（含总进度百分比）
│       ├── mine/                    # 我的页面（头像/昵称/签名/标签管理入口/提醒订阅）
│       ├── tags/                    # 存款标签管理
│       └── category/                # 分类管理
```

---

## 3. 数据库集合

全部权限设为「仅创建者可读写」：

| 集合名 | 用途 | 关键字段 |
|--------|------|----------|
| `wishlist_item` | 心愿物品 | `user_id`, `name`, `current_price`, `target_price`, `saving_target_amount`, `status`, `image_urls`(数组), `image_url`(首图兼容) |
| `category` | 分类 | `user_id`, `name`, `color`, `sort_order` |
| `price_record` | 价格记录 | `user_id`, `item_id`, `price`, `recorded_at` |
| `saving_record` | 存款记录 | `user_id`, `item_id`, `amount`, `saving_type`(dedicated/pool) |
| `pool_allocation` | 通用池分配 | `user_id`, `item_id`, `amount` |
| `task` | 任务清单 | `user_id`, `item_id`, `title`, `is_completed` |
| `saving_record_tag` | 存款标签（旧版，已弃用） | `saving_record_id`, `tag_id` |
| `deposit_tag` | ★ 存款标签定义 | `user_id`, `name`, `color`, `sort_order` |
| `purchase_record` | 购买记录 | `user_id`, `item_id`, `final_price` |

---

## 4. 已完成功能

- [x] 微信登录（login 云函数）
- [x] 添加/编辑/删除心愿（wishlist 云函数）
- [x] 心愿列表：筛选（状态/分类/优先级）+ 排序 + 搜索
- [x] 心愿列表：优先级可见、已购/放弃卡片置灰、进度条颜色变化
- [x] 心愿详情：价格信息、价格历史、存款进度、存款明细、任务列表
- [x] 心愿硬删除（详情页底部）
- [x] 首页：统计总览 + 重点心愿（进度最高/临近 deadline/低于目标价）
- [x] 更新价格 → 自动生成价格记录 + 自动计算史低价
- [x] 价格记录删除
- [x] 专项存款 + 存款记录删除
- [x] 通用存款池存入 + 手动分配至心愿 + 分配撤销
- [x] 存款进度自动计算
- [x] 任务清单（添加/切换/编辑/删除）
- [x] 任务长按编辑标题
- [x] 标记已购买/暂缓/放弃
- [x] 分类管理（CRUD + 物品计数）
- [x] 统计页：总览 + 本月数据 + 状态分布 + 总存款进度
- [x] 价格 WXS 格式化（所有页面）
- [x] 云函数统一错误处理（wrapHandler）
- [x] 数据分页安全（fetchAll 避免 100 条截断）
- [x] 所有权校验（requireOwnership）
- [x] 页面数据加载器（Loader 消除竞争条件）
- [x] 列表批量充实（listEnriched 消除 N+1）
- [x] 所有列表页下拉刷新
- [x] 金钱操作二次确认
- [x] 分类名详情页正确显示
- [x] 状态管理统一入口（ActionSheet 切换，支持恢复）
- [x] 统计页存款中计数修复（与 display_status 逻辑一致）
- [x] 优先级标签颜色（高/中/低 红/橙/蓝紫）
- [x] Deadline 清除按钮（新增/编辑页）
- [x] 表单输入框优化（padding 加大 + URL 换用 textarea）
- [x] 存款页底部按钮栏（替代 FAB + 号）
- [x] 统计页卡片 2 列布局（分布更均匀）
- [x] 价格记录备注（更新价格时可选填写）
- [x] 存款记录备注（添加存款时可选填写）
- [x] 三张商品图（image_urls 数组 + 3 图上传 + 详情轮播 + 列表角标）
- [x] 目标存款比例滑块（新增/编辑页，10%-100%，步长 5%）
- [x] 统计页可购买/存款中与列表一致
- [x] pool_allocation 云函数查询（解决客户端查不到问题）
- [x] 价格历史 + 存款明细折叠（默认 3 条，可展开/收起）
- [x] 定期存入计划（从通用池定期自动存入，含余额/终态等边界处理）
- [x] 含定期存入的预计完成日（与仅历史存款对比展示）
- [x] 通用池存入备注（与专项存款一致的两步弹窗）
- [x] 分类点击查看心愿列表（category 跳转 wishlist 自动筛选）
- [x] 空状态引导文案优化（wishlist/index/savings）

---

## 5. 待办事项

### 5.1 功能完善

- [x] TabBar 图标（10 张 PNG，81x81px）— `scripts/generate-icons.js` 生成
- [x] 存款标签功能（标签选择、标签统计）— 标签 CRUD + 存款关联 + 统计
- [x] 价格趋势图（price_record >= 3 条时展示）
- [x] Deadline 提醒（订阅消息）— `notify` 云函数 + 定时触发器，代码已完成
- [ ] **⚠️ 订阅消息模板 ID** — 微信后台审核中，需替换 `notify/index.js` 和 `mine.js` 中 `YOUR_TEMPLATE_ID_HERE`
- [x] 定期存入定时触发器（目前手动触发，可加云函数定时器自动执行）— `saving` 云函数 `autoSaveTimer` 触发器

### 5.2 体验优化

- [ ] 实时搜索栏（当前为模态弹窗，体验差）
- [ ] 空状态引导文案优化 + 插图（文案 ✅，插图待做）
- [ ] 加载骨架屏
- [ ] 分类拖拽排序
- [ ] 任务拖拽排序
- [x] 分类点击查看其下心愿列表

### 5.3 技术债务

- [ ] `saving` 云函数 `saveTags` 逐条写入（暂无批量 API，标签数少影响可控）
- [ ] `wishlist_item` 数据库索引确认（`user_id`、`updated_at` 等复合索引）
- [ ] `stats` 云函数每次全量计算（可考虑缓存）
- [ ] `pool.js` 等待 openid 的轮询逻辑改为事件驱动

### 5.4 后期扩展（v2+）

- [ ] 自动价格监控、多平台比价
- [ ] 按比例自动分配通用池
- [ ] AI 购买建议
- [ ] 月度预算
- [ ] 共同心愿
- [ ] 数据导出
- [ ] 购买后复盘

---

## 6. 开发注意事项

### 6.0 Skill 调用规则（Agent 必读）
- **开发新功能**时，先 invoke `develop-feature` skill，按流程执行：读代码 → 方案 → 编码 → 验证清单 → 更新文档
- **修复 Bug** 时，先 invoke `fix-bug` skill，按流程执行：复现 → 定位根因 → 修复 → 记录
- **开发完成**后，invoke `deploy-check` 给出部署清单
- **会话结束**前，invoke `update-context` 更新本文档和记忆文件

### 6.1 修改云函数后
必须右键 → **上传并部署：云端安装依赖**，否则云端跑的仍是旧代码。

### 6.2 新增云函数时的规范
```js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const { wrapHandler, fetchAll, requireOwnership, db, _ } = require('./common');

exports.main = async (event, context) => {
  const openid = cloud.getWXContext().OPENID;
  return wrapHandler(() => {
    // switch/case 路由
  });
};
```

### 6.3 新增页面时的规范
- 多数据源加载使用 `new Loader(this)` + `.add()` + `.runAll()`
- WXML 格式化使用 `<wxs module="util" src="../../utils/util.wxs"></wxs>` + `{{util.formatMoney(...)}}`
- 所有异步操作需要 try-catch + toast 提示
- 金钱操作在云函数调用前必须加 `util.showConfirm` 二次确认

### 6.4 常见坑
1. **`orderBy`** 参数是 `(fieldName, direction)` 两个字符串，不是对象
2. **`.get()`** 默认最多返回 100 条，必须用 `fetchAll` 或 `skip/limit` 分页
3. **WXML 中 `{{func()}}`** 调用 Page 方法可能静默失败，用 WXS 替代
4. **`Promise.all`** 一个失败全部失败，用 `Loader` 或 `safeAll`
5. **`this.data`** 在并行 async 函数中可能未更新，用 Loader 的 `dependsOn` 声明依赖
6. **`deadline`** 字段可能被云数据库反序列化为 Date 对象，不要直接调用 String 方法
7. **WXML 不支持 `.toFixed()`、嵌套三元等** — 在 JS 中预计算，WXML 只用简单 `{{var}}`
8. **客户端派生状态（overdue/buyable）** 不能传给后端筛选，需客户端过滤或特殊处理
9. **DB status 字段不包含 `saving`/`buyable`/`overdue`** — 这些是客户端 display_status 计算值，统计云函数不能直接查 status，必须同样计算
10. **`display_status` 不能纯数据驱动** — 用户显式设为 `paused` 时应该原样展示。`planning` 是初始状态应该参与自动推导
11. **客户端直查集合可能因权限/索引静默失败** — 云函数创建的文档，客户端查询受集合权限影响。调试时优先用云函数查询（服务端不受限），加 `.catch` 时务必打 log
12. **云函数调用必须检查 `result.code`** — `wx.cloud.callFunction` 不 throw on 业务错误码，不检查 code 会导致失败也显示"成功"
13. **`box-sizing` 不继承** — CSS 中 `box-sizing: border-box` 需显式设置到每个需要精确宽度计算的元素上
14. **定期存入余额不足** — `executeAutoSave` 失败时需向用户提示具体余额缺口；预计完成日计算需考虑余额仅能支撑 N 期
15. **微信 `<button>` 默认样式不可信** — button 有内置的 `margin: auto`（居中）、内部 padding（裁图）、`::after` 伪元素（占位），CSS 逐个覆盖效果不稳定。**正确做法**：外层 view wrapper 控制尺寸和间距，button 只做 100% 透明填充 + `border-radius: 0`，圆形外观由 image 自身 `border-radius: 50%` 实现。不要在 button 和 image 上同时设圆角（双重裁剪）。调试 >3 次仍不对就换结构，不要继续调参

---

## 7. 重要修改记录

### 2026-06-17（第六轮：5.1 完善 + 详情页优化 + 筛选修复）

**5.1 功能完善：**
- TabBar 图标：`scripts/generate-icons.js` 生成 10 张 81×81 PNG
- 存款标签：`deposit_tag` 集合 + `saving` 云函数 CRUD + `stats` 云函数标签统计 + `pages/tags/` 管理页
- Deadline 提醒：`notify` 云函数（定时 + 订阅消息），模板 ID 待微信审核
- 定期存入定时器：`saving/config.json` + `runAutoSaveBatch()`

**详情页优化：**
- 图片点击 `wx.previewImage` 全屏预览
- 分类标签展示（云函数查询，解决客户端权限问题）+ 点击切换
- 优先级标签可点击切换（与状态标签统一 `▾` 下拉模式）

**Bug 修复：**
- `saving` 云函数 `listAllocations` 缺失 `_` 导入 → 分配记录显示"已删除"
- `saving`/`buyable` 筛选：`listItemsEnriched` 服务端 `computeDisplayStatus` + `fetchAll` 全量，客户端 `wx.nextTick` 防时序
- 首页卡片可点击跳转 → wishlist 自动筛选（`pendingWishlistFilter`）
- `target_save_percent` 缺失 `|| 100` fallback 导致旧数据判定异常
- Mine 页布局重构：微信 button 默认样式隔离（wrapper + border-radius: 0）

**新坑记录：**
- 微信 `<button>` 不可信 → 用 wrapper 隔离（见 6.4 第 15 条）
- `onShow` 中 `setData` 后立即 `loadItems` 可能读到旧 `this.data` → 用 `wx.nextTick` 延迟

### 2026-06-17（折叠 + 定期存入 + 体验优化 — 第五轮）

**云函数新增（saving）：**
- `setAutoSave` — 创建/更新定期存入计划（upsert 模式，同一心愿只保留一条）
- `disableAutoSave` — 软停用定期存入计划
- `executeAutoSave` — 手动触发当期存入，含边界处理（余额不足/心愿终态/剩余目标 cap）
- `getAutoSavePlan` — 查询心愿的定期存入计划

**详情页改造（detail）：**
- 价格历史 + 存款明细默认展示 3 条，超过 3 条显示"展开全部 (N 条)"按钮
- 新增定期存入设置区：未设置引导 → 金额 → 周期（每天/每周/每月）→ 确认
- 已设置时展示计划详情 + "立即执行本期存入" + "修改计划" + "停用"
- 预计完成日分两行：仅历史存款 + 含定期存入
- 考虑通用池余额上限对预计完成日的影响

**通用池存入备注（pool）：**
- 存入改为两步弹窗（金额 → 备注），与专项存款体验一致

**分类点击查看心愿（category → wishlist）：**
- 分类行加 bindtap，通过 `app.globalData.pendingCategoryFilter` 传递筛选参数
- wishlist `onShow` 检查并消费 pendingCategoryFilter，自动应用分类筛选

**空状态文案优化：**
- wishlist: "📝 还没有心愿" + 引导文案
- index: "✨ 添加第一个心愿吧"
- savings: "💰 还没有存款记录"

**数据库：**
- 新增集合 `auto_save_plan`（user_id, item_id, enabled, amount, frequency, last_executed_at）

**修改文件清单（12 个）：**
`cloudfunctions/saving/index.js`、
`miniprogram/pages/detail/detail.js`、`detail.wxml`、`detail.wxss`、
`miniprogram/pages/pool/pool.js`、
`miniprogram/pages/category/category.js`、`category.wxml`、
`miniprogram/pages/wishlist/wishlist.js`、`wishlist.wxml`、
`miniprogram/pages/index/index.wxml`、
`miniprogram/pages/savings/savings.wxml`、
`miniprogram/app.js`

---

### 2026-06-17（统计修复 + 分配记录 + 目标存款比例 — 第四轮）

**云函数修改：**
- `stats/index.js` — 去掉 planning 特殊逻辑（误伤所有默认 planning 的心愿），去掉 hasEnough 限制，buyable = priceMet || progressMet
- `saving/index.js` — 新增 `listAllocations` action（服务端查 pool_allocation，解决客户端权限/索引导致查不到的问题）

**统计页修复：**
- `.stat-card` 添加 `box-sizing: border-box`（修复右侧空白）
- stats 与 wishlist 的 display_status 判定完全对齐

**目标存款比例（add 页）：**
- 新增 `<slider>` 控件，10%-100%，步长 5%，默认 100%
- 实时提示"存到 XX% 即视为可购买"

**pool_allocation 查询改造：**
- detail.js `loadSavingRecords`：客户端 `db.collection('pool_allocation')` → `saving.listAllocations` 云函数
- pool.js `loadAllocations`：同上改造 + 加 try-catch + 移除 openid 轮询
- detail.js + pool.js 分配函数：加 `result.code !== 0` 检查，防止静默失败
- pool 页分配记录 ↩ → 🗑 图标统一

**修改文件清单：**
`cloudfunctions/stats/index.js`、`cloudfunctions/saving/index.js`、
`miniprogram/pages/detail/detail.js`、
`miniprogram/pages/pool/pool.js`、`pool.wxml`、
`miniprogram/pages/stats/stats.wxss`、
`miniprogram/pages/wishlist/wishlist.js`、
`miniprogram/pages/add/add.wxml`、`add.js`、`add.wxss`

---

### 2026-06-17（状态管理 + 统计修复 + 多图/备注 — 第三轮）

**云函数修改（2 个）：**
- `stats/index.js` — 重写 saving/buyable 计数逻辑：逐 item 计算 display_status，与客户端一致，互斥计数。修复"存款中始终为 0"和 saving/buyable 重叠 Bug
- `wishlist/index.js` — 新增 `image_urls` 数组字段支持（同步写 `image_url` 首图兼容旧数据）

**状态管理改造（detail + wishlist）：**
- 详情页状态标签可点击 → `wx.showActionSheet` 统一切换（merge 了原来三个独立按钮）
- 暂缓/放弃可恢复为计划中（填补不可逆缺陷）
- 底部按钮区精简为"编辑"+"删除"，移除独立的状态按钮
- `display_status` 计算重写：尊重 `planning`/`paused`（不自动升级为 buyable），与其他派生状态分离

**重点心愿去重（index）：**
- 引入 `usedIds` Set，进度 → deadline → 价格依次选取，同一心愿不再重复出现

**优先级标签颜色（wishlist）：**
- `tag-priority`（灰色）→ `tag-{{item.priority}}`，复用全局红/橙/蓝紫样式

**Deadline 清除（add）：**
- 日期选择器旁新增 "✕ 清除" 按钮 → `clearDeadline()` 置空

**表单输入框优化（add + app.wxss）：**
- `.form-input` padding 20→24rpx
- 商品链接 `<input>` → `<textarea auto-height>`，长链接可换行显示

**存款页按钮（savings）：**
- FAB "+" → 底部固定按钮栏 "💰 记录存款"（`bottom-bar` 组件）

**统计页布局（stats）：**
- 卡片 3 列 → 2 列，7 张卡分布更均匀

**价格/存款备注（detail）：**
- 更新价格：金额弹窗 → 备注弹窗（可选），传 `note` 到 price 云函数
- 添加存款：金额弹窗 → 备注弹窗（可选），传 `note` 到 saving 云函数
- 云函数端已支持 `note` 字段，无需修改

**三张商品图（add + detail + wishlist + wishlist 云函数）：**
- DB：`wishlist_item` 新增 `image_urls` 数组，`image_url` 保留为首图兼容
- 新增页：单图 → 3 图网格（`image-upload-grid`），支持逐张删除
- 详情页：≥2 张时显示 swiper 轮播（indicator-dots）
- 列表页：卡片图片角标"N图"

**修改文件清单（13 个）：**
`cloudfunctions/stats/index.js`、`cloudfunctions/wishlist/index.js`、
`miniprogram/pages/detail/detail.js`、`detail.wxml`、`detail.wxss`、
`miniprogram/pages/wishlist/wishlist.js`、`wishlist.wxml`、`wishlist.wxss`、
`miniprogram/pages/index/index.js`、
`miniprogram/pages/add/add.js`、`add.wxml`、`add.wxss`、
`miniprogram/pages/savings/savings.wxml`、`savings.wxss`、
`miniprogram/pages/stats/stats.wxss`、
`miniprogram/app.wxss`

---

### 2026-06-16（UX 体验优化 — 第二轮）

**云函数新增操作（3 个云函数）：**
- `saving/index.js` — 新增 `deleteRecord`（删除存款记录）+ `deallocate`（撤销分配，资金退回通用池）
- `price/index.js` — 新增 `delete`（删除价格记录）
- `task/index.js` — 新增 `update`（编辑任务标题）

**详情页改造（detail）：**
- 新增价格历史展示卡片（历史价格 + 删除按钮）
- 新增存款明细列表（专项存款 + 通用池分配合并展示，支持删除/撤销）
- 新增删除心愿按钮（底部文字链，二次确认）
- 修复分类名始终为空 Bug（`loadItem()` 中查询 category 集合）
- 新增任务长按编辑（`bindlongpress` → `editTask`）
- 金钱操作增加二次确认（`util.showConfirm`）

**心愿列表优化（wishlist）：**
- 卡片新增优先级标签（高/中/低）
- 已购买/已放弃卡片视觉降级（opacity 0.55 + 图片灰度）
- 进度条颜色变化：<50% 橙色 → 50-99% 蓝色 → 100% 绿色
- 修复已逾期筛选（客户端过滤，后端传 `all`）
- 新增已放弃/暂缓筛选选项
- 新增价格最低排序
- status_text/priority_text 预计算避免 WXML 调用 Page 方法

**存款记录优化（savings）：**
- 新增汇总卡片（专项存款总额 / 通用池存入总额）
- 专项存款记录显示关联心愿进度迷你条
- 新增删除按钮
- 专项存款导航增加提示引导

**通用池优化（pool）：**
- 存款记录新增删除按钮
- 分配记录新增撤销按钮（↩ 图标，资金退回通用池）

**全局优化：**
- 全部 6 个主要页面启用下拉刷新（`enablePullDownRefresh` + `onPullDownRefresh`）
- 统计页新增总存款进度百分比
- 首页 "更新价格" → "浏览心愿"（修正误导标签）
- 分类页编辑/删除按钮放大至 64rpx（触摸友好）
- 分类名 trim 校验（拒绝纯空格名称）
- 我的页 "提醒设置" / "关于" 实现点击反馈

---

### 2026-06-16（工程化改造 — 第一轮）

**新建文件：**
- `cloudfunctions/common/index.js`、`package.json`
- `miniprogram/utils/dataLoader.js`
- `miniprogram/utils/util.wxs`

**重写云函数（6 个）：**
- `cloudfunctions/task/index.js` — wrapHandler + requireOwnership
- `cloudfunctions/saving/index.js` — wrapHandler + fetchAll + 金额校验
- `cloudfunctions/price/index.js` — wrapHandler + fetchAll + 存在性检查
- `cloudfunctions/stats/index.js` — wrapHandler + fetchAll 全覆盖
- `cloudfunctions/category/index.js` — wrapHandler + requireOwnership + batchCountByField
- `cloudfunctions/wishlist/index.js` — wrapHandler + requireOwnership + listEnriched

**重写页面 JS（7 个）：**
- `pages/detail/detail.js` — Loader + 全部 handler 加 try-catch
- `pages/wishlist/wishlist.js` — listEnriched + display_status
- `pages/pool/pool.js` — Loader + 批量查询 + 独立计算
- `pages/savings/savings.js` — 批量查 item 名 + try-catch
- `pages/index/index.js` — 改用 listEnriched
- `pages/add/add.js` — 修复 deadline Date 崩溃
- `pages/category/category.js` — 全部加 try-catch

**修改 WXML（7 个）：**
- 全部引入 WXS `util.formatMoney` 替代 Page 方法调用

---

## 8. 验证流程

1. 首页显示心愿总数、重点心愿卡片
2. 心愿列表正常加载，状态筛选/排序/搜索正常
3. 心愿详情页：价格历史、存款明细、任务列表全部加载
4. 添加/编辑心愿 → 提交成功
5. 更新价格 → 价格历史生成 → 史低价正确
6. 添加专项存款 → 进度更新 → 存款明细显示
7. 通用池存入 → 分配至心愿 → 撤销分配
8. 删除存款记录 / 删除价格记录 / 删除心愿
9. 添加任务 → 勾选完成 → 长按编辑 → 删除任务
10. 标记已购买 / 暂缓 / 放弃
11. 已购买/已放弃心愿在列表中视觉降级
12. 下拉刷新各页面正常
13. 分类管理 CRUD 正常，触摸区域友好
14. 统计页"存款中"显示正确的非零数字
15. 状态标签点击 → ActionSheet → 暂缓 → 恢复计划中（可逆）
16. 优先级标签：高=红色、中=橙色、低=蓝紫色
17. 重点心愿三张卡片不重复
18. 更新价格时可输入备注（优惠券等）
19. 添加存款时可输入备注（少点外卖等）
20. 新增心愿可上传 3 张图，详情页 swiper 轮播
21. Deadline 可清除（编辑页 ✕ 按钮）
22. 存款页底部按钮栏显示 "💰 记录存款"
23. 价格历史 > 3 条时折叠，点击展开/收起
24. 存款明细 > 3 条时折叠，点击展开/收起
25. 设置定期存入：金额 → 选择周期 → 确认 → 计划展示在详情页
26. 手动执行定期存入：余额充足成功 → 余额不足提示具体缺口
27. 定期存入停用/修改
28. 预计完成日：两行展示（仅历史 + 含定期存入）
29. 通用池存入：金额 → 备注 → 确认
30. 分类页点分类 → wishlist 页自动筛选该分类
31. TabBar 5 个页面图标显示正常（灰/紫两态）
32. 存款标签：创建/编辑/删除 → detail/savings 页标签 chip 展示 → 统计页标签统计卡片
33. Mine 页：头像左对齐 + 昵称/签名可编辑 → 提醒设置弹出订阅授权
34. 详情页图片点击 → 全屏预览可左右滑动
35. 详情页分类/优先级标签点击 → ActionSheet 切换
36. 首页统计卡片点击 → wishlist 自动筛选对应状态
37. 存款分配记录正确显示心愿名称（非"已删除"）
