// 云函数：存款管理（专项存款 + 通用存款池）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const { wrapHandler, fetchAll, requireOwnership, db, _ } = require('./common');

exports.main = async (event, context) => {
  // 定时触发器：每天自动执行到期定期存入计划
  if (event.TriggerName === 'autoSaveTimer') {
    return runAutoSaveBatch();
  }

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
      case 'setAutoSave':    return setAutoSave(openid, data);
      case 'disableAutoSave': return disableAutoSave(openid, data);
      case 'executeAutoSave': return executeAutoSave(openid, data);
      case 'getAutoSavePlan': return getAutoSavePlan(openid, data.item_id);
      // 存款标签
      case 'createTag': return createTag(openid, data);
      case 'updateTag': return updateTag(openid, data);
      case 'deleteTag': return deleteTag(openid, data);
      case 'listTags':  return listTags(openid);
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
    tag_ids: data.tag_ids || [],
    saved_at: data.saved_at ? new Date(data.saved_at) : new Date(),
    created_at: new Date(),
  };
  const result = await db.collection('saving_record').add({ data: record });
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
    tag_ids: data.tag_ids || [],
    saved_at: data.saved_at ? new Date(data.saved_at) : new Date(),
    created_at: new Date(),
  };
  const result = await db.collection('saving_record').add({ data: record });
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

// 获取存款记录列表（含标签名）
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

  // 批量获取标签名
  const tagMap = await getTagNameMap(openid);

  const enriched = records.data.map(r => ({
    ...r,
    tag_names: (r.tag_ids || []).map(id => tagMap[id] || '未知标签').filter(Boolean),
  }));

  return {
    code: 0,
    data: { records: enriched, total: countResult.total },
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

// 查询通用池分配记录（云函数端，绕过客户端权限问题，含物品名）
async function listAllocations(openid, options) {
  const { item_id, pageSize = 50 } = options || {};
  const where = { user_id: openid };
  if (item_id) where.item_id = item_id;

  const records = await fetchAll(
    db.collection('pool_allocation').where(where)
  );

  // 按时间降序
  records.sort((a, b) => new Date(b.allocated_at) - new Date(a.allocated_at));

  // 批量获取物品名称（服务端查询，不受客户端权限限制）
  const itemIds = [...new Set(records.map(a => a.item_id).filter(Boolean))];
  const itemMap = {};
  if (itemIds.length > 0) {
    try {
      const items = await fetchAll(
        db.collection('wishlist_item').where({ _id: _.in(itemIds) }),
        itemIds.length + 10
      );
      for (const item of items) {
        itemMap[item._id] = item.name;
      }
    } catch (e) {
      console.error('批量获取物品名失败:', e);
    }
  }

  // 附加物品名到每条记录
  const enriched = records.slice(0, pageSize).map(r => ({
    ...r,
    item_name: itemMap[r.item_id] || '已删除',
  }));

  return {
    code: 0,
    data: {
      records: enriched,
      total: records.length,
    },
  };
}

// ============================================================
// 定期存入计划（从通用池定期自动分配至指定心愿）
// ============================================================

// 创建/更新定期存入计划
async function setAutoSave(openid, data) {
  const amount = parseFloat(data.amount);
  if (isNaN(amount) || amount <= 0) return { code: -1, msg: '金额必须为正数' };
  if (!data.item_id) return { code: -1, msg: '缺少物品ID' };

  const validFrequencies = ['daily', 'weekly', 'monthly'];
  const frequency = data.frequency || 'weekly';
  if (!validFrequencies.includes(frequency)) {
    return { code: -1, msg: '无效的周期，可选 daily/weekly/monthly' };
  }

  // 校验心愿存在且非终态
  try {
    await requireOwnership('wishlist_item', data.item_id, openid);
    const itemRes = await db.collection('wishlist_item').doc(data.item_id).get();
    const item = itemRes.data;
    if (item.status === 'purchased' || item.status === 'abandoned') {
      return { code: -1, msg: '该心愿已完成或已放弃，无法设置定期存入' };
    }
  } catch (err) {
    return { code: -1, msg: err.message || '心愿不存在' };
  }

  // upsert：同一 user_id + item_id 只保留一条计划
  const existing = await db.collection('auto_save_plan')
    .where({ user_id: openid, item_id: data.item_id })
    .get();

  const planData = {
    user_id: openid,
    item_id: data.item_id,
    enabled: true,
    amount,
    frequency,
    last_executed_at: existing.data.length > 0
      ? (existing.data[0].last_executed_at || null)
      : null,
    updated_at: new Date(),
  };

  if (existing.data.length > 0) {
    await db.collection('auto_save_plan').doc(existing.data[0]._id).update({ data: planData });
    return { code: 0, msg: '已更新', data: { _id: existing.data[0]._id, ...planData } };
  }

  planData.created_at = new Date();
  const result = await db.collection('auto_save_plan').add({ data: planData });
  return { code: 0, msg: '已设置', data: { _id: result._id, ...planData } };
}

// 停用定期存入计划
async function disableAutoSave(openid, data) {
  if (!data.item_id) return { code: -1, msg: '缺少物品ID' };

  const existing = await db.collection('auto_save_plan')
    .where({ user_id: openid, item_id: data.item_id })
    .get();

  if (existing.data.length === 0) {
    return { code: -1, msg: '未找到定期存入计划' };
  }

  await db.collection('auto_save_plan').doc(existing.data[0]._id).update({
    data: { enabled: false, updated_at: new Date() },
  });

  return { code: 0, msg: '已停用' };
}

// 手动执行当期存入（单次）
async function executeAutoSave(openid, data) {
  if (!data.item_id) return { code: -1, msg: '缺少物品ID' };

  // 1. 查找计划
  const planRes = await db.collection('auto_save_plan')
    .where({ user_id: openid, item_id: data.item_id, enabled: true })
    .get();

  if (planRes.data.length === 0) {
    return { code: -1, msg: '未找到启用的定期存入计划' };
  }

  const plan = planRes.data[0];

  // 2. 周期校验：距上次执行需满一个周期
  if (plan.last_executed_at) {
    const now = new Date();
    const lastExec = new Date(plan.last_executed_at);
    const elapsedMs = now - lastExec;
    const freqDays = { daily: 1, weekly: 7, monthly: 30 };
    const requiredMs = (freqDays[plan.frequency] || 7) * 24 * 60 * 60 * 1000;

    if (elapsedMs < requiredMs) {
      const remainingMs = requiredMs - elapsedMs;
      const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
      const freqLabels = { daily: '天', weekly: '周', monthly: '月' };
      return {
        code: -1,
        msg: `周期未到，距上次执行不足1${freqLabels[plan.frequency] || '周'}（还需约${remainingDays}天）`,
      };
    }
  }

  // 3. 校验心愿状态
  try {
    await requireOwnership('wishlist_item', data.item_id, openid);
    const itemRes = await db.collection('wishlist_item').doc(data.item_id).get();
    const item = itemRes.data;
    if (item.status === 'purchased' || item.status === 'abandoned') {
      // 心愿终态，自动停用计划
      await db.collection('auto_save_plan').doc(plan._id).update({
        data: { enabled: false, updated_at: new Date() },
      });
      return { code: -1, msg: '该心愿已完成或已放弃，定期存入已自动停用' };
    }
  } catch (err) {
    return { code: -1, msg: err.message || '心愿不存在' };
  }

  // 3. 获取通用池余额
  const poolBalance = await getPoolBalanceValue(openid);
  if (poolBalance <= 0) {
    return { code: -1, msg: '通用池余额为 0，请先存入资金' };
  }

  // 4. 计算实际分配金额
  let actualAmount = plan.amount;
  if (actualAmount > poolBalance) {
    return {
      code: -1,
      msg: `通用池余额不足，当前余额 ¥${poolBalance.toFixed(2)}，需要 ¥${plan.amount.toFixed(2)}`,
    };
  }

  // 边界：心愿剩余目标 < 定期金额 → cap 到剩余目标
  const savingsData = await getItemSavings(openid, data.item_id);
  const targetAmount = (await db.collection('wishlist_item').doc(data.item_id).get()).data.saving_target_amount || 0;
  const remaining = targetAmount - savingsData.data.total;
  if (remaining <= 0) {
    return { code: -1, msg: '存款已达到目标，无需继续存入' };
  }
  if (actualAmount > remaining) {
    actualAmount = remaining;
  }

  // 5. 创建分配记录
  const allocation = {
    user_id: openid,
    item_id: data.item_id,
    amount: actualAmount,
    allocation_method: 'auto',
    note: `定期存入（${plan.frequency === 'daily' ? '每天' : plan.frequency === 'weekly' ? '每周' : '每月'} ¥${plan.amount.toFixed(2)}）`,
    allocated_at: new Date(),
  };
  await db.collection('pool_allocation').add({ data: allocation });

  // 6. 更新执行时间
  await db.collection('auto_save_plan').doc(plan._id).update({
    data: { last_executed_at: new Date(), updated_at: new Date() },
  });

  return {
    code: 0,
    msg: actualAmount < plan.amount
      ? `已存入 ¥${actualAmount.toFixed(2)}（已达目标，实际金额小于计划金额）`
      : `已存入 ¥${actualAmount.toFixed(2)}`,
    data: { actual_amount: actualAmount },
  };
}

// 获取某心愿的定期存入计划
async function getAutoSavePlan(openid, itemId) {
  if (!itemId) return { code: -1, msg: '缺少物品ID' };

  const res = await db.collection('auto_save_plan')
    .where({ user_id: openid, item_id: itemId })
    .get();

  if (res.data.length === 0) {
    return { code: 0, data: { plan: null } };
  }

  return { code: 0, data: { plan: res.data[0] } };
}

// ============================================================
// 存款标签 CRUD
// ============================================================

// 创建标签
async function createTag(openid, data) {
  const name = (data.name || '').trim();
  if (!name) return { code: -1, msg: '标签名不能为空' };
  if (name.length > 10) return { code: -1, msg: '标签名最多10个字' };

  // 重名检查
  const exist = await db.collection('deposit_tag')
    .where({ user_id: openid, name })
    .get();
  if (exist.data.length > 0) return { code: -1, msg: '标签名已存在' };

  const colors = ['#FF6B6B', '#FFA726', '#66BB6A', '#42A5F5', '#AB47BC', '#EC407A', '#26C6DA', '#FF7043'];
  const tagData = {
    user_id: openid,
    name,
    color: data.color || colors[Math.floor(Math.random() * colors.length)],
    sort_order: data.sort_order || 0,
    created_at: new Date(),
  };
  const result = await db.collection('deposit_tag').add({ data: tagData });
  return { code: 0, data: { _id: result._id, ...tagData } };
}

// 更新标签
async function updateTag(openid, data) {
  if (!data.id) return { code: -1, msg: '缺少标签ID' };
  await requireOwnership('deposit_tag', data.id, openid);

  const updates = { updated_at: new Date() };
  if (data.name !== undefined) {
    const name = (data.name || '').trim();
    if (!name) return { code: -1, msg: '标签名不能为空' };
    if (name.length > 10) return { code: -1, msg: '标签名最多10个字' };
    updates.name = name;
  }
  if (data.color !== undefined) updates.color = data.color;
  if (data.sort_order !== undefined) updates.sort_order = data.sort_order;

  await db.collection('deposit_tag').doc(data.id).update({ data: updates });
  return { code: 0, msg: '已更新' };
}

// 删除标签
async function deleteTag(openid, data) {
  if (!data.id) return { code: -1, msg: '缺少标签ID' };
  await requireOwnership('deposit_tag', data.id, openid);

  // 从所有存款记录中移除该标签
  const records = await fetchAll(
    db.collection('saving_record').where({ user_id: openid })
  );
  for (const r of records) {
    if (r.tag_ids && r.tag_ids.includes(data.id)) {
      const newTagIds = r.tag_ids.filter(id => id !== data.id);
      await db.collection('saving_record').doc(r._id).update({ data: { tag_ids: newTagIds } });
    }
  }

  await db.collection('deposit_tag').doc(data.id).remove();
  return { code: 0, msg: '已删除' };
}

// 获取标签列表
async function listTags(openid) {
  const tags = await fetchAll(
    db.collection('deposit_tag').where({ user_id: openid }),
    100
  );
  tags.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  return { code: 0, data: { tags } };
}

// 批量获取标签名映射（内部使用）
async function getTagNameMap(openid) {
  try {
    const tags = await fetchAll(
      db.collection('deposit_tag').where({ user_id: openid }),
      100
    );
    const map = {};
    for (const t of tags) {
      map[t._id] = t.name;
    }
    return map;
  } catch (e) {
    return {};
  }
}

// ============================================================
// 定时触发器：批量执行到期的定期存入计划
// ============================================================
async function runAutoSaveBatch() {
  try {
    // 获取所有启用的定期存入计划
    const plans = await fetchAll(
      db.collection('auto_save_plan').where({ enabled: true }),
      1000
    );

    if (plans.length === 0) {
      return { code: 0, msg: '无启用的定期存入计划', executed: 0 };
    }

    const now = new Date();
    const freqDays = { daily: 1, weekly: 7, monthly: 30 };
    let executed = 0, skipped = 0, failed = 0;

    for (const plan of plans) {
      try {
        // 周期检查
        if (plan.last_executed_at) {
          const lastExec = new Date(plan.last_executed_at);
          const elapsedMs = now - lastExec;
          const requiredMs = (freqDays[plan.frequency] || 7) * 24 * 60 * 60 * 1000;
          if (elapsedMs < requiredMs) {
            skipped++;
            continue;
          }
        }

        // 检查心愿状态
        let item;
        try {
          const itemRes = await db.collection('wishlist_item').doc(plan.item_id).get();
          item = itemRes.data;
        } catch (e) {
          skipped++;
          continue;
        }

        if (!item || item.status === 'purchased' || item.status === 'abandoned') {
          // 终态，自动停用
          await db.collection('auto_save_plan').doc(plan._id).update({
            data: { enabled: false, updated_at: now },
          });
          skipped++;
          continue;
        }

        // 计算实际存入金额
        const poolBalance = await getPoolBalanceValue(plan.user_id);
        if (poolBalance <= 0) { failed++; continue; }

        let actualAmount = plan.amount;
        if (actualAmount > poolBalance) { failed++; continue; }

        const savingsData = await getItemSavings(plan.user_id, plan.item_id);
        const targetAmount = (item.saving_target_amount || 0);
        const remaining = targetAmount - savingsData.data.total;
        if (remaining <= 0) { skipped++; continue; }
        if (actualAmount > remaining) actualAmount = remaining;

        // 创建分配记录
        await db.collection('pool_allocation').add({
          data: {
            user_id: plan.user_id,
            item_id: plan.item_id,
            amount: actualAmount,
            allocation_method: 'auto',
            note: `定期存入（${plan.frequency === 'daily' ? '每天' : plan.frequency === 'weekly' ? '每周' : '每月'} ¥${plan.amount.toFixed(2)}）`,
            allocated_at: now,
          },
        });

        // 更新执行时间
        await db.collection('auto_save_plan').doc(plan._id).update({
          data: { last_executed_at: now, updated_at: now },
        });

        executed++;
      } catch (e) {
        console.error(`执行定期存入失败 (plan:${plan._id}):`, e.message);
        failed++;
      }
    }

    return {
      code: 0,
      msg: `已执行 ${executed} 笔，跳过 ${skipped} 笔，失败 ${failed} 笔`,
      executed, skipped, failed,
    };
  } catch (err) {
    console.error('批量定期存入失败:', err);
    return { code: -1, msg: err.message };
  }
}
