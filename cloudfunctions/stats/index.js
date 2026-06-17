// 云函数：统计数据
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const { wrapHandler, fetchAll, db } = require('./common');

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  return wrapHandler(() => getStats(openid));
};

async function getStats(openid) {
  // 使用 fetchAll 替代 .get()，避免超过 100 条后数据截断
  const [
    items,
    poolInRecords,
    poolAllocRecords,
    dedicatedRecords,
    purchasedCount,
    abandonedCount,
  ] = await Promise.all([
    fetchAll(db.collection('wishlist_item').where({ user_id: openid })),
    fetchAll(db.collection('saving_record').where({ user_id: openid, saving_type: 'pool' })),
    fetchAll(db.collection('pool_allocation').where({ user_id: openid })),
    fetchAll(db.collection('saving_record').where({ user_id: openid, saving_type: 'dedicated' })),
    db.collection('wishlist_item').where({ user_id: openid, status: 'purchased' }).count(),
    db.collection('wishlist_item').where({ user_id: openid, status: 'abandoned' }).count(),
  ]);

  // 计算汇总数据
  const totalWishes = items.length;

  // 构建每 item 的存款汇总（用于判断"存款中"状态）
  const itemSavingsMap = {};
  for (const r of dedicatedRecords) {
    if (!itemSavingsMap[r.item_id]) itemSavingsMap[r.item_id] = 0;
    itemSavingsMap[r.item_id] += r.amount;
  }
  for (const r of poolAllocRecords) {
    if (!itemSavingsMap[r.item_id]) itemSavingsMap[r.item_id] = 0;
    itemSavingsMap[r.item_id] += r.amount;
  }

  // display_status 派生逻辑（与客户端 wishlist.js 保持一致）
  // purchased / abandoned / paused → 原样
  // planning（用户显式设回）→ 只判断 overdue，不自动升级为 buyable
  // 其他 → 自动判断 overdue / buyable / saving / planning
  let savingCount = 0;
  let buyableCount = 0;
  const now = new Date();

  for (const item of items) {
    if (item.status === 'purchased' || item.status === 'abandoned') continue;

    const saved = itemSavingsMap[item._id] || 0;
    const isOverdue = item.deadline && new Date(item.deadline) < now;
    const priceMet = item.target_price && item.current_price <= item.target_price;
    const targetPercent = item.target_save_percent || 100;
    const hasEnough = item.saving_target_amount > 0 && saved >= item.saving_target_amount;
    const progressMet = item.saving_target_amount > 0
      && (saved / item.saving_target_amount * 100) >= targetPercent;

    if (item.status === 'paused') {
      // 暂缓不参与 saving/buyable 计数
      continue;
    }

    if (item.status === 'planning') {
      // 用户显式计划中，不自动升级为 buyable
      if (saved > 0 && !isOverdue) savingCount++;
      continue;
    }

    // 自动判断
    if (isOverdue) {
      continue; // overdue 不参与 saving/buyable
    }

    if (hasEnough && (priceMet || progressMet)) {
      buyableCount++;
    } else if (saved > 0) {
      savingCount++;
    }
  }

  const totalTargetAmount = items.reduce((sum, i) => sum + (i.saving_target_amount || 0), 0);

  const totalPoolIn = poolInRecords.reduce((sum, r) => sum + r.amount, 0);
  const totalPoolAllocated = poolAllocRecords.reduce((sum, r) => sum + r.amount, 0);
  const poolBalance = totalPoolIn - totalPoolAllocated;

  const totalDedicated = dedicatedRecords.reduce((sum, r) => sum + r.amount, 0);
  const totalSaved = totalDedicated + totalPoolAllocated;

  // 本月数据（复用上面的 now）
  // const now = new Date(); — 已在上面声明
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const monthSavings = [...poolInRecords, ...dedicatedRecords]
    .filter(r => new Date(r.saved_at) >= monthStart)
    .reduce((sum, r) => sum + r.amount, 0);

  const monthNewItems = items.filter(i => new Date(i.created_at) >= monthStart).length;

  // 分类统计
  const categoryStats = {};
  for (const item of items) {
    const catId = item.category_id || 'default';
    if (!categoryStats[catId]) {
      categoryStats[catId] = { count: 0, total_target: 0, total_saved: 0, completed: 0 };
    }
    categoryStats[catId].count++;
    categoryStats[catId].total_target += item.saving_target_amount || 0;
    if (item.status === 'purchased') categoryStats[catId].completed++;
  }

  return {
    code: 0,
    data: {
      total_wishes: totalWishes,
      saving_count: savingCount,
      buyable_count: buyableCount,
      purchased_count: purchasedCount.total,
      abandoned_count: abandonedCount.total,
      total_target_amount: totalTargetAmount,
      total_saved_amount: totalSaved,
      pool_balance: poolBalance,
      month_savings: monthSavings,
      month_new_items: monthNewItems,
      category_stats: categoryStats,
    },
  };
}
