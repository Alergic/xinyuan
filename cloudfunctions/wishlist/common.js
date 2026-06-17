// ============================================================
// 心愿计划 - 云函数公共工具模块
// 提供统一错误处理、安全分页、所有权校验、批量查询
// ============================================================
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// ============================================================
// 1. 统一错误处理包装器
// ============================================================

/**
 * 包装云函数 handler，捕获所有异常并返回标准化格式。
 * 用法：
 *   exports.main = async (event, context) => {
 *     const openid = cloud.getWXContext().OPENID;
 *     return wrapHandler(() => router(event, openid));
 *   };
 */
async function wrapHandler(fn) {
  try {
    return await fn();
  } catch (err) {
    console.error('[CloudFunction Error]', err.message, err.stack);
    return {
      code: -1,
      msg: err.message || '服务内部错误',
    };
  }
}

// ============================================================
// 2. 安全分页获取全部记录（解决 .get() 100 条截断）
// ============================================================

/**
 * 自动分页获取全部匹配记录。
 * 微信云数据库 .get() 默认最多返回 100 条，此函数透明地分页获取全部。
 *
 * @param {object} query - db.collection('x').where(...) 链（不要调用 .get()）
 * @param {number} maxRecords - 安全上限，默认 5000
 * @returns {Array} 全部匹配记录
 */
async function fetchAll(query, maxRecords = 5000) {
  const BATCH_SIZE = 100;
  const allData = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore && allData.length < maxRecords) {
    const res = await query.skip(offset).limit(BATCH_SIZE).get();
    allData.push(...res.data);
    offset += BATCH_SIZE;
    if (res.data.length < BATCH_SIZE) {
      hasMore = false;
    }
  }

  return allData;
}

// ============================================================
// 3. 所有权校验
// ============================================================

/**
 * 校验文档存在且属于当前用户，否则抛出错误。
 *
 * @param {string} collection - 集合名
 * @param {string} docId - 文档 ID
 * @param {string} openid - 当前用户 openid
 * @returns {object} 文档数据
 */
async function requireOwnership(collection, docId, openid) {
  if (!docId) {
    throw new Error('缺少文档ID');
  }
  const res = await db.collection(collection).doc(docId).get();
  if (!res.data || (Array.isArray(res.data) && res.data.length === 0)) {
    throw new Error('文档不存在');
  }
  const doc = Array.isArray(res.data) ? res.data[0] : res.data;
  if (doc.user_id && doc.user_id !== openid) {
    throw new Error('无权操作此文档');
  }
  return doc;
}

// ============================================================
// 4. 批量分组计数（替代 N+1 循环 count）
// ============================================================

/**
 * 按某字段分组计数文档数量。
 *
 * @param {string} collection - 集合名
 * @param {string} groupField - 分组字段
 * @param {object} baseWhere - 基础查询条件
 * @returns {object} Map<fieldValue, count>
 */
async function batchCountByField(collection, groupField, baseWhere = {}) {
  const allDocs = await fetchAll(
    db.collection(collection).where(baseWhere),
    5000
  );
  const counts = {};
  for (const doc of allDocs) {
    const key = doc[groupField] || 'default';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

// ============================================================
// 5. 批量根据 ID 获取文档（替代 N+1 逐条查）
// ============================================================

/**
 * 批量获取文档，返回 Map<_id, doc>。
 *
 * @param {string} collection - 集合名
 * @param {string[]} ids - 文档 ID 数组
 * @param {object} extraWhere - 额外查询条件
 * @returns {object} Map<_id, doc>
 */
async function batchGetByIds(collection, ids, extraWhere = {}) {
  if (!ids || ids.length === 0) return {};

  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const resultMap = {};

  const allDocs = await fetchAll(
    db.collection(collection).where({
      ...extraWhere,
      _id: _.in(uniqueIds),
    }),
    uniqueIds.length + 10
  );

  for (const doc of allDocs) {
    resultMap[doc._id] = doc;
  }
  return resultMap;
}

// ============================================================
// 6. 字段校验
// ============================================================

/**
 * 校验必填字段，缺少则抛出错误。
 */
function requireFields(data, fields) {
  for (const field of fields) {
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      throw new Error(`缺少必要字段: ${field}`);
    }
  }
}

/**
 * 校验金额为合法正数，返回数字。
 */
function validateAmount(value) {
  const num = parseFloat(value);
  if (isNaN(num) || num <= 0) {
    throw new Error('金额必须为正数');
  }
  return num;
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  wrapHandler,
  fetchAll,
  requireOwnership,
  batchCountByField,
  batchGetByIds,
  requireFields,
  validateAmount,
  db,
  _,
};
