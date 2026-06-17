// 云函数：分类管理
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const { wrapHandler, requireOwnership, batchCountByField, db } = require('./common');

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  return wrapHandler(() => {
    const { action, data } = event;
    switch (action) {
      case 'add':    return addCategory(openid, data);
      case 'update': return updateCategory(openid, data);
      case 'delete': return deleteCategory(openid, data.id);
      case 'list':   return listCategories(openid);
      default:       return { code: -1, msg: '未知操作' };
    }
  });
};

async function addCategory(openid, data) {
  const cat = {
    user_id: openid,
    name: data.name,
    icon: data.icon || '',
    color: data.color || '#5C6BC0',
    sort_order: data.sort_order || 0,
    created_at: new Date(),
  };
  const result = await db.collection('category').add({ data: cat });
  return { code: 0, data: { _id: result._id, ...cat } };
}

async function updateCategory(openid, data) {
  const { id, ...updateData } = data;
  // 校验所有权
  await requireOwnership('category', id, openid);
  await db.collection('category').doc(id).update({ data: updateData });
  return { code: 0, msg: '更新成功' };
}

async function deleteCategory(openid, id) {
  // 校验所有权
  await requireOwnership('category', id, openid);
  await db.collection('category').doc(id).remove();
  // 将该分类下的物品设为未分类
  await db.collection('wishlist_item')
    .where({ user_id: openid, category_id: id })
    .update({ data: { category_id: 'default' } });
  return { code: 0, msg: '删除成功' };
}

async function listCategories(openid) {
  const cats = await db.collection('category')
    .where({ user_id: openid })
    .orderBy('sort_order', 'asc')
    .get();

  // 批量分组计数，替代逐条 count（消除 N+1 问题）
  const counts = await batchCountByField(
    'wishlist_item', 'category_id', { user_id: openid }
  );

  for (const cat of cats.data) {
    cat.item_count = counts[cat._id] || 0;
  }

  return { code: 0, data: cats.data };
}
