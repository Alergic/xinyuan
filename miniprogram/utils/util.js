/**
 * 心愿计划 - 工具函数
 */

/**
 * 格式化金额，保留两位小数
 */
const formatMoney = (num) => {
  if (num === null || num === undefined) return '0.00';
  return Number(num).toFixed(2);
};

/**
 * 格式化日期为 YYYY-MM-DD
 */
const formatDate = (date) => {
  if (!date) return '';
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * 格式化日期为 YYYY-MM-DD HH:mm
 */
const formatDateTime = (date) => {
  if (!date) return '';
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
};

/**
 * 计算距离目标日期的剩余天数
 * 返回负数表示已逾期
 */
const getDaysRemaining = (deadline) => {
  if (!deadline) return null;
  const now = new Date();
  const target = new Date(deadline);
  const diff = target.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
};

/**
 * 生成唯一 ID（简易版）
 */
const generateId = () => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}${random}`;
};

/**
 * 计算存款进度百分比
 */
const calcProgress = (saved, target) => {
  if (!target || target === 0) return 0;
  return Math.min(Math.round((saved / target) * 100), 100);
};

/**
 * 计算预计完成天数
 * @param {number} remaining - 剩余所需金额
 * @param {number} dailyAvg - 平均每日存款
 */
const calcEstimatedDays = (remaining, dailyAvg) => {
  if (!dailyAvg || dailyAvg <= 0) return null;
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / dailyAvg);
};

/**
 * Toast 提示封装
 */
const showToast = (title, icon = 'none') => {
  wx.showToast({ title, icon, duration: 2000 });
};

/**
 * 确认弹窗封装
 */
const showConfirm = (content, title = '提示') => {
  return new Promise((resolve) => {
    wx.showModal({
      title,
      content,
      success: (res) => resolve(res.confirm),
      fail: () => resolve(false),
    });
  });
};

/**
 * 从云数据库获取用户隔离条件
 */
const userCondition = () => {
  const app = getApp();
  const openid = app.globalData.openid;
  if (!openid) {
    console.warn('openid 尚未获取');
  }
  return { user_id: openid || '' };
};

module.exports = {
  formatMoney,
  formatDate,
  formatDateTime,
  getDaysRemaining,
  generateId,
  calcProgress,
  calcEstimatedDays,
  showToast,
  showConfirm,
  userCondition,
};
