// 云函数：任务清单管理
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const { wrapHandler, requireOwnership, db } = require('./common');

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  return wrapHandler(() => {
    const { action, data } = event;
    switch (action) {
      case 'add':    return addTask(openid, data);
      case 'update': return updateTask(openid, data);
      case 'toggle': return toggleTask(openid, data.id);
      case 'delete': return deleteTask(openid, data.id);
      case 'list':   return listTasks(openid, data ? data.item_id : undefined);
      default:       return { code: -1, msg: '未知操作' };
    }
  });
};

async function addTask(openid, data) {
  // 新任务排序值：查询当前最大 sort_order + 1
  let maxSort = 0;
  try {
    const existing = await db.collection('task')
      .where({ user_id: openid, item_id: data.item_id })
      .orderBy('sort_order', 'desc')
      .limit(1)
      .get();
    if (existing.data.length > 0) {
      maxSort = (existing.data[0].sort_order || 0) + 1;
    }
  } catch (e) { /* ignore */ }

  const task = {
    user_id: openid,
    item_id: data.item_id,
    title: data.title,
    description: data.description || '',
    task_type: data.task_type || '',
    deadline: data.deadline || null,
    is_completed: false,
    completed_at: null,
    sort_order: maxSort,
    created_at: new Date(),
  };
  const result = await db.collection('task').add({ data: task });
  return { code: 0, data: { _id: result._id, ...task } };
}

async function updateTask(openid, data) {
  await requireOwnership('task', data.id, openid);
  const toUpdate = {};
  if (data.title !== undefined) toUpdate.title = data.title;
  if (data.description !== undefined) toUpdate.description = data.description;
  if (data.deadline !== undefined) toUpdate.deadline = data.deadline;
  if (data.sort_order !== undefined) toUpdate.sort_order = data.sort_order;
  await db.collection('task').doc(data.id).update({ data: toUpdate });
  return { code: 0, msg: '更新成功' };
}

async function toggleTask(openid, id) {
  const task = await requireOwnership('task', id, openid);
  const isNowCompleted = !task.is_completed;
  await db.collection('task').doc(id).update({
    data: {
      is_completed: isNowCompleted,
      completed_at: isNowCompleted ? new Date() : null,
    },
  });
  return { code: 0, data: { is_completed: isNowCompleted } };
}

async function deleteTask(openid, id) {
  await requireOwnership('task', id, openid);
  await db.collection('task').doc(id).remove();
  return { code: 0, msg: '删除成功' };
}

async function listTasks(openid, itemId) {
  const where = { user_id: openid };
  if (itemId) where.item_id = itemId;

  const tasks = await db.collection('task')
    .where(where)
    .orderBy('sort_order', 'asc')
    .get();

  return { code: 0, data: tasks.data };
}
