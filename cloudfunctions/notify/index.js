// 云函数：Deadline 提醒
// 定时触发器每天 9:00 执行，检查即将到期的 deadline 并发送订阅消息
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const { fetchAll, db } = require('./common');

// ★ 订阅消息模板 ID — 需在微信公众平台申请后填入
// 模板示例：物品名称、截止日期、当前价格、剩余天数
const TEMPLATE_ID = 'YOUR_TEMPLATE_ID_HERE';

exports.main = async (event, context) => {
  // 定时触发器调用
  if (event.TriggerName === 'dailyCheck') {
    return checkAndNotify();
  }
  // 手动调用（订阅消息授权）
  if (event.action === 'subscribe') {
    return handleSubscribe(event);
  }
  return { code: -1, msg: '未知操作' };
};

// 检查即将到期的 deadline 并发送提醒
async function checkAndNotify() {
  const now = new Date();
  // 查询未来 3 天内到期的 deadline
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + 3);

  try {
    // 获取所有未完成的心愿（含 deadline）
    const items = await fetchAll(
      db.collection('wishlist_item')
        .where({
          status: db.command.in(['planning', 'paused', 'saving']),
        })
    );

    const dueItems = items.filter(item => {
      if (!item.deadline) return false;
      const d = new Date(item.deadline);
      return d >= now && d <= endDate;
    });

    if (dueItems.length === 0) {
      return { code: 0, msg: '无即将到期的 deadline', count: 0 };
    }

    // 按用户分组
    const userMap = {};
    for (const item of dueItems) {
      if (!userMap[item.user_id]) userMap[item.user_id] = [];
      userMap[item.user_id].push(item);
    }

    let sent = 0;
    for (const [openid, userItems] of Object.entries(userMap)) {
      for (const item of userItems) {
        try {
          await sendReminder(openid, item);
          sent++;
        } catch (e) {
          console.error(`发送提醒失败 (${item.name}):`, e.message);
        }
      }
    }

    return { code: 0, msg: `已发送 ${sent} 条提醒`, count: sent };
  } catch (err) {
    console.error('检查 deadline 失败:', err);
    return { code: -1, msg: err.message };
  }
}

// 发送单条订阅消息
async function sendReminder(openid, item) {
  const deadline = new Date(item.deadline);
  const now = new Date();
  const remainDays = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));

  // 计算存款进度
  const savings = await fetchAll(
    db.collection('saving_record')
      .where({ user_id: openid, item_id: item._id, saving_type: 'dedicated' })
  );
  const savedDedicated = savings.reduce((sum, r) => sum + r.amount, 0);

  const allocs = await fetchAll(
    db.collection('pool_allocation')
      .where({ user_id: openid, item_id: item._id })
  );
  const savedAlloc = allocs.reduce((sum, r) => sum + r.amount, 0);

  const totalSaved = savedDedicated + savedAlloc;
  const target = item.saving_target_amount || 0;
  const progress = target > 0 ? Math.round((totalSaved / target) * 100) : 0;

  // 发送订阅消息
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: openid,
      templateId: TEMPLATE_ID,
      data: {
        thing1: { value: item.name.substring(0, 20) },
        date2: { value: `${deadline.getFullYear()}-${String(deadline.getMonth() + 1).padStart(2, '0')}-${String(deadline.getDate()).padStart(2, '0')}` },
        number3: { value: `${remainDays}天` },
        amount4: { value: `¥${(item.current_price || 0).toFixed(2)}` },
        phrase5: { value: progress >= 100 ? '已达标' : `还差${progress}%` },
      },
      page: `pages/detail/detail?id=${item._id}`,
    });
  } catch (err) {
    // 用户未订阅或模板 ID 无效时会失败
    if (err.errCode === 43101) {
      // 用户未订阅，跳过
      console.log(`用户 ${openid} 未订阅消息，跳过`);
    } else {
      throw err;
    }
  }
}

// 处理订阅授权（客户端调用 wx.requestSubscribeMessage 后通知服务端记录）
async function handleSubscribe(event) {
  // 微信订阅消息只需客户端调用 wx.requestSubscribeMessage 即可
  // 服务端无需额外操作，此入口预留给后续记录订阅偏好的场景
  return { code: 0, msg: 'ok' };
}
