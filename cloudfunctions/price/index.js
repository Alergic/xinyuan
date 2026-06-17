// 云函数：价格记录
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const { wrapHandler, fetchAll, requireOwnership, db } = require('./common');

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  return wrapHandler(() => {
    const { action, data } = event;
    switch (action) {
      case 'add':     return addPrice(openid, data);
      case 'delete':  return deletePrice(openid, data.id);
      case 'history': return getHistory(openid, data.item_id);
      case 'lowest':  return getLowest(openid, data.item_id);
      default:        return { code: -1, msg: '未知操作' };
    }
  });
};

// 添加价格记录（同时更新物品当前价格）
async function addPrice(openid, data) {
  const price = parseFloat(data.price);
  if (isNaN(price) || price <= 0) return { code: -1, msg: '价格必须为正数' };

  // 校验物品存在
  let item;
  try {
    item = await db.collection('wishlist_item').doc(data.item_id).get();
  } catch (e) {
    return { code: -1, msg: '心愿物品不存在' };
  }
  if (!item.data) {
    return { code: -1, msg: '心愿物品不存在' };
  }

  const record = {
    item_id: data.item_id,
    user_id: openid,
    price,
    platform: data.platform || '',
    url: data.url || '',
    note: data.note || '',
    recorded_at: data.recorded_at ? new Date(data.recorded_at) : new Date(),
  };

  // 添加价格记录
  const result = await db.collection('price_record').add({ data: record });

  // 同步更新物品的当前价格
  await db.collection('wishlist_item').doc(data.item_id).update({
    data: {
      current_price: price,
      updated_at: new Date(),
    },
  });

  // 检查是否达到目标价格
  if (item.data.target_price && price <= item.data.target_price) {
    await db.collection('wishlist_item').doc(data.item_id).update({
      data: { status: 'buyable', updated_at: new Date() },
    });
  }

  return { code: 0, data: { _id: result._id, ...record } };
}

// 删除价格记录
async function deletePrice(openid, recordId) {
  await requireOwnership('price_record', recordId, openid);
  await db.collection('price_record').doc(recordId).remove();
  return { code: 0, msg: '删除成功' };
}

// 获取历史价格记录
async function getHistory(openid, itemId) {
  // 使用 fetchAll 避免超过 100 条后数据截断
  const records = await fetchAll(
    db.collection('price_record')
      .where({ user_id: openid, item_id: itemId })
  );

  // 按时间降序排列
  records.sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at));

  // 计算史低价
  const prices = records.map(r => r.price);
  const lowest = prices.length > 0 ? Math.min(...prices) : null;

  return {
    code: 0,
    data: {
      records,
      lowest_price: lowest,
      count: records.length,
      show_chart: records.length >= 3,
    },
  };
}

// 获取史低价
async function getLowest(openid, itemId) {
  const records = await fetchAll(
    db.collection('price_record')
      .where({ user_id: openid, item_id: itemId })
  );

  const prices = records.map(r => r.price);
  const lowest = prices.length > 0 ? Math.min(...prices) : null;

  return { code: 0, data: { lowest_price: lowest } };
}
