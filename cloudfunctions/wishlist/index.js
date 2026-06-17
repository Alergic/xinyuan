// 云函数：心愿物品 CRUD
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const { wrapHandler, requireOwnership, fetchAll, db, _ } = require('./common');

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  return wrapHandler(() => {
    const { action, data } = event;
    switch (action) {
      case 'add':         return addItem(openid, data);
      case 'update':      return updateItem(openid, data);
      case 'delete':      return deleteItem(openid, data.id);
      case 'get':         return getItem(openid, data.id);
      case 'list':        return listItems(openid, data || {});
      case 'listEnriched':return listItemsEnriched(openid, data || {});
      default:            return { code: -1, msg: '未知操作' };
    }
  });
};

// 添加心愿物品
async function addItem(openid, data) {
  const imageUrls = (data.image_urls && data.image_urls.length > 0)
    ? data.image_urls.filter(Boolean)
    : (data.image_url ? [data.image_url] : []);

  const item = {
    user_id: openid,
    category_id: data.category_id || 'default',
    name: data.name,
    image_url: imageUrls.length > 0 ? imageUrls[0] : '',
    image_urls: imageUrls,
    product_url: data.product_url || '',
    description: data.description || '',
    current_price: parseFloat(data.current_price) || 0,
    target_price: data.target_price ? parseFloat(data.target_price) : null,
    saving_target_amount: parseFloat(data.saving_target_amount) || parseFloat(data.current_price) || 0,
    target_save_percent: parseFloat(data.target_save_percent) || 100,
    priority: data.priority || 'medium',
    status: 'planning',
    deadline: data.deadline || null,
    deadline_type: data.deadline_type || '',
    estimated_finish_date: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const result = await db.collection('wishlist_item').add({ data: item });
  return { code: 0, data: { _id: result._id, ...item } };
}

// 更新心愿物品
async function updateItem(openid, data) {
  const { id, ...updateData } = data;
  // 校验所有权
  await requireOwnership('wishlist_item', id, openid);

  // 处理多图：image_urls 更新时同步更新 image_url（首图）
  if (updateData.image_urls !== undefined) {
    const urls = updateData.image_urls.filter(Boolean);
    updateData.image_url = urls.length > 0 ? urls[0] : '';
    updateData.image_urls = urls;
  }

  // 只更新提供的字段
  const toUpdate = {};
  const allowedFields = [
    'category_id', 'name', 'image_url', 'image_urls', 'product_url',
    'description', 'current_price', 'target_price', 'saving_target_amount',
    'target_save_percent', 'priority', 'status', 'deadline',
    'deadline_type',
  ];
  for (const key of allowedFields) {
    if (updateData[key] !== undefined) {
      toUpdate[key] = updateData[key];
    }
  }
  toUpdate.updated_at = new Date();

  await db.collection('wishlist_item').doc(id).update({ data: toUpdate });
  return { code: 0, msg: '更新成功' };
}

// 删除心愿物品
async function deleteItem(openid, id) {
  await requireOwnership('wishlist_item', id, openid);
  await db.collection('wishlist_item').doc(id).remove();
  return { code: 0, msg: '删除成功' };
}

// 获取单个物品详情
async function getItem(openid, id) {
  const item = await requireOwnership('wishlist_item', id, openid);
  return { code: 0, data: item };
}

// 获取物品列表（带筛选和排序）
async function listItems(openid, options) {
  const { category_id, status, priority, keyword, sort = 'updated_at', order = 'desc', page = 1, pageSize = 20 } = options;

  // 构建查询条件
  const where = { user_id: openid };
  if (category_id && category_id !== 'all') where.category_id = category_id;
  if (status && status !== 'all') where.status = status;
  if (priority && priority !== 'all') where.priority = priority;
  if (keyword) where.name = db.RegExp({ regexp: keyword, options: 'i' });

  // 排序字段白名单
  const allowedSortFields = ['created_at', 'updated_at', 'deadline', 'current_price'];
  const sortField = allowedSortFields.includes(sort) ? sort : 'updated_at';
  const sortDirection = order === 'asc' ? 'asc' : 'desc';

  const skip = (page - 1) * pageSize;

  const [items, countResult] = await Promise.all([
    db.collection('wishlist_item')
      .where(where)
      .orderBy(sortField, sortDirection)
      .skip(skip)
      .limit(pageSize)
      .get(),
    db.collection('wishlist_item').where(where).count(),
  ]);

  return {
    code: 0,
    data: {
      items: items.data,
      total: countResult.total,
      page,
      pageSize,
    },
  };
}

// ============================================================
// 获取物品列表（增强版：批量查询存款和史低价，消除客户端 N+1）
// ============================================================
async function listItemsEnriched(openid, options) {
  // 1. 获取基础分页列表
  const listResult = await listItems(openid, options);
  if (listResult.code !== 0 || !listResult.data.items.length) {
    return listResult;
  }

  const items = listResult.data.items;
  const itemIds = items.map(i => i._id);

  // 2. 批量查询存款（专项 + 通用池分配）
  const [dedicatedRecords, poolAllocRecords] = await Promise.all([
    fetchAll(db.collection('saving_record')
      .where({ user_id: openid, item_id: _.in(itemIds), saving_type: 'dedicated' })
    ),
    fetchAll(db.collection('pool_allocation')
      .where({ user_id: openid, item_id: _.in(itemIds) })
    ),
  ]);

  // 构建存款汇总映射
  const savingsMap = {};
  for (const r of dedicatedRecords) {
    if (!savingsMap[r.item_id]) savingsMap[r.item_id] = { dedicated: 0, pool: 0 };
    savingsMap[r.item_id].dedicated += r.amount;
  }
  for (const r of poolAllocRecords) {
    if (!savingsMap[r.item_id]) savingsMap[r.item_id] = { dedicated: 0, pool: 0 };
    savingsMap[r.item_id].pool += r.amount;
  }

  // 3. 批量查询史低价（一次查询所有相关价格记录）
  const priceRecords = await fetchAll(
    db.collection('price_record')
      .where({ user_id: openid, item_id: _.in(itemIds) })
  );

  const lowestPriceMap = {};
  for (const r of priceRecords) {
    if (lowestPriceMap[r.item_id] === undefined || r.price < lowestPriceMap[r.item_id]) {
      lowestPriceMap[r.item_id] = r.price;
    }
  }

  // 4. 充实每个 item 的数据
  for (const item of items) {
    const s = savingsMap[item._id] || { dedicated: 0, pool: 0 };
    item.dedicated_saved = s.dedicated;
    item.pool_allocated = s.pool;
    item.total_saved = s.dedicated + s.pool;
    item.lowest_price = lowestPriceMap[item._id] || null;
  }

  return {
    code: 0,
    data: {
      items,
      total: listResult.data.total,
      page: listResult.data.page,
      pageSize: listResult.data.pageSize,
    },
  };
}
