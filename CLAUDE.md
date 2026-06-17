# 心愿计划 — 项目上下文

> 最后更新：2026-06-17

---

## 🚨 开发流程（Agent 必读）

**核心原则：先出方案，再改代码。不跳步、不猜测。**

| 用户意图 | 触发词 | 必须先调用 | 禁止行为 |
|----------|-------|-----------|----------|
| 新功能/优化 | 新增/添加/优化/实现/改进 | `Skill: develop-feature` | 禁止不写方案就编码 |
| Bug 修复 | 修复/有问题/不对/不显示/bug | `Skill: fix-bug` | 禁止不改根因只改表象 |
| 开发完成 | 功能或修复结束 | `Skill: deploy-check` | 禁止不输出部署清单 |
| 会话结束 | 关闭对话前 | `Skill: update-context` | 禁止不更新本文档 |
| 大改动（>3 文件或新逻辑） | — | `EnterPlanMode` → 方案 → 确认 → 编码 | 禁止改完再 review |

```
小迭代：Skill → Read → 方案 → 确认 → 编码 → 自查 → 部署清单 → commit
```

---

## 项目简介

心愿计划是一款微信小程序，帮助用户记录想买的物品、追踪价格变化、管理存款进度。

- **平台**：微信小程序 + 云开发 | 基础库 3.12.1 | 按量计费

---

## 1. 技术栈约定

### 编码规范（强制）

- 云函数：`wrapHandler` 包装入口 + `requireOwnership` 校验 + `fetchAll` 避免 100 条截断
- 页面加载：`new Loader(this)` 替代 `Promise.all`
- WXML 格式化：WXS `util.formatMoney()`，**禁止调用 Page 方法**
- WXML 中**禁止复杂表达式**（`.toFixed()`、嵌套三元）→ JS 预计算
- 金钱操作：云函数调用前**必须** `util.showConfirm` 二次确认
- 云函数返回值：**必须检查 `result.code`**，`wx.cloud.callFunction` 不 throw 业务错误码

### 关键设计决策（不要推翻）

| 约定 | 说明 |
|------|------|
| `display_status` 是客户端派生值 | DB 中 `status` 只有 `planning/purchased/paused/abandoned`。`saving/buyable/overdue` 由 JS 计算 |
| `pool_allocation` 只能云函数查询 | 客户端 SDK 直查受权限限制会静默返回空 → 用 `saving.listAllocations` |
| 图片存储 | `image_urls` 数组（新）+ `image_url` 首图兼容（旧） |
| 定期存入 | 独立集合 `auto_save_plan`（非 wishlist_item 字段），upsert 模式，软停用 |
| 云函数模板 | 见 [6.2 节](#62-新增云函数时的规范) |

---

## 2. 项目结构

```
xinyuan/
├── cloudfunctions/
│   ├── common/        # ★ 公共工具
│   ├── wishlist/      # 心愿 CRUD + listEnriched
│   ├── saving/        # 存款/分配/标签/定期存入
│   ├── price/         # 价格记录 + 史低价
│   ├── task/          # 任务清单
│   ├── stats/         # 数据统计
│   ├── notify/        # Deadline 订阅消息提醒
│   ├── category/      # 分类管理
│   └── login/         # 微信登录
├── miniprogram/
│   ├── utils/
│   │   ├── util.js / util.wxs / dataLoader.js
│   └── pages/
│       ├── index/     # 首页：统计总览 + 重点心愿
│       ├── wishlist/  # 心愿列表：筛选/排序/搜索
│       ├── add/       # 添加/编辑心愿
│       ├── detail/    # 心愿详情：价格/存款/任务
│       ├── pool/      # 通用存款池
│       ├── savings/   # 存款记录列表
│       ├── stats/     # 数据统计
│       ├── mine/      # 我的：头像/昵称/标签管理/提醒
│       ├── tags/      # 存款标签管理
│       └── category/  # 分类管理
```

---

## 3. 数据库集合

全部权限：「仅创建者可读写」

| 集合 | 用途 | 关键字段 |
|------|------|----------|
| `wishlist_item` | 心愿物品 | `user_id`, `name`, `current_price`, `target_price`, `saving_target_amount`, `target_save_percent`, `status`, `image_urls`, `image_url` |
| `saving_record` | 存款记录 | `user_id`, `item_id`, `amount`, `saving_type`, `tag_ids`, `note` |
| `pool_allocation` | 通用池分配 | `user_id`, `item_id`, `amount`, `allocation_method` |
| `auto_save_plan` | 定期存入计划 | `user_id`, `item_id`, `enabled`, `amount`, `frequency` |
| `price_record` | 价格记录 | `user_id`, `item_id`, `price`, `note` |
| `deposit_tag` | 存款标签 | `user_id`, `name`, `color` |
| `category` | 分类 | `user_id`, `name`, `color` |
| `task` | 任务清单 | `user_id`, `item_id`, `title`, `is_completed` |
| `purchase_record` | 购买记录 | `user_id`, `item_id`, `final_price` |

---

## 4. 待办事项

### 当前迭代

- [ ] ⚠️ 订阅消息模板 ID（微信审核中）— 替换 `notify/index.js` 和 `mine.js` 中的 `YOUR_TEMPLATE_ID_HERE`
- [ ] 实时搜索栏（当前为模态弹窗 → 改为列表顶部常驻搜索框）
- [ ] 加载骨架屏
- [ ] 空状态插图（文案已有）
- [ ] 分类拖拽排序
- [ ] 任务拖拽排序

### 技术债务

- [ ] `wishlist_item` 数据库复合索引确认
- [ ] `stats` 云函数全量计算 → 加缓存
- [ ] `pool.js` openid 轮询 → 事件驱动

---

## 5. 常见坑

> 这些是从实际 Bug 中提炼的，修改相关代码前务必回顾。

1. **`orderBy`** 参数是两个字符串 `(fieldName, direction)`，不是对象
2. **`.get()`** 默认 100 条截断 → 用 `fetchAll`
3. **WXML 中 `{{func()}}`** 静默失败 → 用 WXS
4. **`Promise.all`** 单点故障 → 用 `Loader` 独立 try-catch
5. **`this.data`** 在并行 async 中可能过期 → `Loader.dependsOn` 或 `wx.nextTick`
6. **`deadline`** 可能被 DB 反序列化为 Date 对象 → 用 `util.formatDate()`
7. **display_status 派生值**（saving/buyable/overdue）不能传给后端 `where.status`，统计云函数必须同样计算
8. **客户端直查 DB** 可能因权限/索引静默返回空 → 优先走云函数
9. **云函数调用必须检查 `result.code`** — 不 throw，失败也显示成功
10. **`box-sizing: border-box` 不继承** — 每个需要精确宽度的元素显式设置
11. **`target_save_percent`** 旧数据无此字段 → 必须 `|| 100` fallback
12. **微信 `<button>` 不可信** — 内置 margin/padding/`::after` 伪元素。用外层 view wrapper 控制尺寸，button 只做 100% 透明填充 + `border-radius: 0`。不要 button + image 双重圆角裁剪
13. **`planning` 筛选混入存款中数据** — `planning` 是 DB status，但已有存款的 item 的 display_status 已升级为 `saving`。筛选 `planning` 时走 display_status 派生逻辑，不能直接 DB where

---

## 6. 开发笔记

### 6.1 修改云函数后
右键 → **上传并部署：云端安装依赖**（否则跑旧代码）

### 6.2 新增云函数时的规范
```js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const { wrapHandler, fetchAll, requireOwnership, db, _ } = require('./common');

exports.main = async (event, context) => {
  // 定时触发器
  if (event.TriggerName === 'xxx') return handleTrigger();
  const openid = cloud.getWXContext().OPENID;
  return wrapHandler(() => {
    switch (event.action) {
      case 'add': return add(openid, event.data);
      default: return { code: -1, msg: '未知操作' };
    }
  });
};
```

### 6.3 新增页面规范
- 多数据源 → `new Loader(this)` + `.add()` + `.runAll()`
- WXML 格式化 → `<wxs module="util" src="../../utils/util.wxs">` + `{{util.formatMoney(...)}}`
- 异步操作 → try-catch + toast
- 金钱操作 → 云函数调用前 `util.showConfirm`

---

## 7. 修改历史

| 日期 | 轮次 | 要点 |
|------|------|------|
| 06-17 | 七 | 存款标签体验：确认弹窗显示标签名、chip 用真实颜色、视觉优化、pool 页加标签 |
| 06-17 | 六 | 5.1 完善（图标/标签/提醒/定时器）、筛选修复（planning 派生/wx.nextTick 时序）、Mine 布局 |
| 06-17 | 五 | 折叠、定期存入计划（auto_save_plan 集合 + 预计完成日）、分类跳转、空状态文案 |
| 06-17 | 四 | 统计修复（display_status 对齐/box-sizing）、分配记录云函数查询、目标存款比例滑块 |
| 06-17 | 三 | 状态 ActionSheet 统一入口、display_status 重写、多图（image_urls + swiper）、备注 |
| 06-16 | 二 | 价格历史/存款明细/删除、优先级标签、逾期筛选、下拉刷新 |
| 06-16 | 一 | 工程化：common 模块/wrapHandler/fetchAll/Loader/WXS、6 个云函数重写 |

---

## 8. 验证流程（核心路径）

| # | 验证路径 | 关键检查点 |
|---|---------|-----------|
| 1 | 首页 → 心愿列表 → 详情 | 统计卡片可点击筛选、列表状态/分类/排序正常、详情数据完整 |
| 2 | 添加心愿 → 编辑 → 删除 | 3 图上传、目标比例滑块、deadline 清除 |
| 3 | 更新价格 → 价格历史 | 史低价自动计算、折叠/展开、趋势图 |
| 4 | 专项存款 → 存款明细 | 金额→备注→标签三步、进度更新、删除/撤销 |
| 5 | 通用池存入 → 分配 → 撤销 | 余额校验、分配记录、标签 chip 显示 |
| 6 | 定期存入 | 设置→执行→停用、余额不足提示、预计完成日两行 |
| 7 | 状态管理 | ActionSheet 切换（含恢复路径）、列表视觉降级 |
| 8 | 统计页 | display_status 计数正确、标签统计带颜色 |
| 9 | Mine 页 | 头像/昵称/签名编辑、标签管理入口、提醒订阅 |
