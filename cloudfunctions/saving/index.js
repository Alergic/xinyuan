// 云函数：存款管理（专项存款 + 通用存款池）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const { wrapHandler, fetchAll, requireOwnership, db } = require('./common');

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  return wrapHandler(() => {
    const { action, data } = event;
    switch (action) {
      case 'addDedicated': return addDedicated(openid, data);
      case 'addPool':      return addPool(openid, data);
      case 'allocate':     return allocatePool(openid, data);
      case 'deleteRecord': return deleteSavingRecord(openid, data.id);
      case 'deallocate':   return deallocatePool(openid, data.id);
      case 'list':           return listSavings(openid, data || {});
      case 'listAllocations': return listAllocations(openid, data || {});
      case 'poolBalance':    return getPoolBalance(openid);
      case 'itemSavings':    return getItemSavings(openid, data.item_id);
      default:             return { code: -1, msg: '未知操作' };
    }
  });
};

// 添加专项存款
async function addDedicated(openid, data) {
  const amount = parseFloat(data.amount);
  if (isNaN(amount) || amount <= 0) return { code: -1, msg: '金额必须为正数' };

  const record = {
    user_id: openid,
    item_id: data.item_id,
    amount,
    saving_type: 'dedicated',
    note: data.note || '',
    saved_at: data.saved_at ? new Date(data.saved_at) : new Date(),
    created_at: new Date(),
  };
  const result = await db.collection('saving_record').add({ data: record });

  // 同步标签关联
  if (data.tags && data.tags.length > 0) {
    await saveTags(openid, result._id, data.tags);
  }

  return { code: 0, data: { _id: result._id, ...record } };
}

// 添加通用池存款
async function addPool(openid, data) {
  const amount = parseFloat(data.amount);
  if (isNaN(amount) || amount <= 0) return { code: -1, msg: '金额必须为正数' };

  const record = {
    user_id: openid,
    item_id: null,
    amount,
    saving_type: 'pool',
    note: data.note || '',
    saved_at: data.saved_at ? new Date(data.saved_at) : new Date(),
    created_at: new Date(),
  };
  const result = await db.collection('saving_record').add({ data: record });

  if (data.tags && data.tags.length > 0) {
    await saveTags(openid, result._id, data.tags);
  }

  return { code: 0, data: { _id: result._id, ...record } };
}

// 通用池分配
async function allocatePool(openid, data) {
  const allocAmount = parseFloat(data.amount);
  if (isNaN(allocAmount) || allocAmount <= 0) return { code: -1, msg: '分配金额必须为正数' };

  const poolBalance = await getPoolBalanceValue(openid);
  if (allocAmount > poolBalance) {
    return { code: -1, msg: '通用池余额不足' };
  }

  const allocation = {
    user_id: openid,
    item_id: data.item_id,
    amount: allocAmount,
    allocation_method: data.allocation_method || 'manual',
    note: data.note || '',
    allocated_at: new Date(),
  };
  await db.collection('pool_allocation').add({ data: allocation });

  return { code: 0, msg: '分配成功' };
}

// 获取存款记录列表
async function listSavings(openid, options) {
  const { type, item_id, page = 1, pageSize = 20 } = options || {};

  const where = { user_id: openid };
  if (type === 'dedicated') where.saving_type = 'dedicated';
  if (type === 'pool') where.saving_type = 'pool';
  if (item_id) where.item_id = item_id;

  const skip = (page - 1) * pageSize;
  const records = await db.collection('saving_record')
    .where(where)
    .orderBy('saved_at', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get();

  const countResult = await db.collection('saving_record').where(where).count();

  return {
    code: 0,
    data: { records: records.data, total: countResult.total },
  };
}

// 获取通用池余额
async function getPoolBalance(openid) {
  const balance = await getPoolBalanceValue(openid);
  return { code: 0, data: { balance } };
}

// 获取通用池余额（内部计算，使用 fetchAll 避免 100 条截断）
async function getPoolBalanceValue(openid) {
  const poolInRecords = await fetchAll(
    db.collection('saving_record').where({ user_id: openid, saving_type: 'pool' })
  );
  const totalPoolIn = poolInRecords.reduce((sum, r) => sum + r.amount, 0);

  const allocRecords = await fetchAll(
    db.collection('pool_allocation').where({ user_id: openid })
  );
  const totalAllocated = allocRecords.reduce((sum, r) => sum + r.amount, 0);

  return Math.max(totalPoolIn - totalAllocated, 0);
}

// 获取某物品的总存款
async function getItemSavings(openid, itemId) {
  const [dedicatedRecords, poolAllocRecords] = await Promise.all([
    fetchAll(db.collection('saving_record')
      .where({ user_id: openid, item_id: itemId, saving_type: 'dedicated' })
    ),
    fetchAll(db.collection('pool_allocation')
      .where({ user_id: openid, item_id: itemId })
    ),
  ]);

  const dedicatedTotal = dedicatedRecords.reduce((sum, r) => sum + r.amount, 0);
  const poolTotal = poolAllocRecords.reduce((sum, r) => sum + r.amount, 0);

  return {
    code: 0,
    data: {
      dedicated: dedicatedTotal,
      pool_allocated: poolTotal,
      total: dedicatedTotal + poolTotal,
    },
  };
}

// 删除存款记录
async function deleteSavingRecord(openid, recordId) {
  await requireOwnership('saving_record', recordId, openid);
  await db.collection('saving_record').doc(recordId).remove();
  return { code: 0, msg: '删除成功' };
}

// 撤销通用池分配（将资金退回通用池）
async function deallocatePool(openid, allocationId) {
  await requireOwnership('pool_allocation', allocationId, openid);
  await db.collection('pool_allocation').doc(allocationId).remove();
  return { code: 0, msg: '撤销成功' };
}

// 查询通用池分配记录（云函数端，绕过客户端权限问题）
async function listAllocations(openid, options) {
  const { item_id, pageSize = 50 } = options || {};
  const where = { user_id: openid };
  if (item_id) where.item_id = item_id;

  const records = await fetchAll(
    db.collection('pool_allocation').where(where)
  );

  // 按时间降序
  records.sort((a, b) => new Date(b.allocated_at) - new Date(a.allocated_at));

  return {
    code: 0,
    data: {
      records: records.slice(0, pageSize),
      total: records.length,
    },
  };
}

// 保存标签关联
// 注意：微信云数据库暂不支持批量 add，只能逐条写入
// 标签数通常不超过 5 个，N+1 影响可控
async function saveTags(openid, savingRecordId, tagIds) {
  const records = tagIds.map(tagId => ({
    saving_record_id: savingRecordId,
    tag_id: tagId,
  }));
  for (const r of records) {
    await db.collection('saving_record_tag').add({ data: r });
  }
}
