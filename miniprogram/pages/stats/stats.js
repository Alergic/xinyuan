// 统计页逻辑
const util = require('../../utils/util.js');

Page({
  data: {
    stats: {
      total_wishes: 0,
      saving_count: 0,
      buyable_count: 0,
      purchased_count: 0,
      abandoned_count: 0,
      total_target_amount: 0,
      total_saved_amount: 0,
      pool_balance: 0,
      month_savings: 0,
      month_new_items: 0,
    },
    tagStatsList: [],
    categoryStatsList: [],
    totalProgress: '0',
    progressColor: '#999',
  },

  onShow() {
    this.loadStats();
  },

  onPullDownRefresh() {
    this.loadStats().finally(() => wx.stopPullDownRefresh());
  },

  async loadStats() {
    wx.showLoading({ title: '加载中...' });
    try {
      const res = await wx.cloud.callFunction({ name: 'stats' });
      const stats = res.result.data;

      // 预计算总进度（WXML 不支持 toFixed 等复杂表达式）
      let totalProgress = '0';
      let progressColor = '#999';
      if (stats.total_target_amount > 0) {
        const pct = (stats.total_saved_amount / stats.total_target_amount) * 100;
        totalProgress = pct.toFixed(1);
        progressColor = stats.total_saved_amount >= stats.total_target_amount
          ? 'var(--color-success)' : 'var(--color-warning)';
      }

      // 标签统计转为排序列表
      const tagStatsList = Object.entries(stats.tag_stats || {})
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.total - a.total);

      // 分类统计：加载分类名称，将 category_id 映射为可读名称+颜色
      let catNameMap = { 'default': { name: '未分类', color: '#999' } };
      try {
        const catRes = await wx.cloud.callFunction({ name: 'category', data: { action: 'list' } });
        const categories = catRes.result.data || [];
        for (const c of categories) {
          catNameMap[c._id] = { name: c.name, color: c.color || '#5C6BC0' };
        }
      } catch (e) { /* ignore */ }

      const categoryStatsList = Object.entries(stats.category_stats || {})
        .map(([catId, data]) => {
          const info = catNameMap[catId] || { name: catId, color: '#999' };
          return { name: info.name, color: info.color, ...data };
        })
        .sort((a, b) => b.count - a.count);

      this.setData({ stats, tagStatsList, categoryStatsList, totalProgress, progressColor });
    } catch (err) {
      console.error('加载统计失败:', err);
    }
    wx.hideLoading();
  },

  formatMoney(num) {
    return util.formatMoney(num);
  },
});
