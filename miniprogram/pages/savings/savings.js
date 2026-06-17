const util = require('../../utils/util.js');

Page({
  data: {
    activeTab: 'all',
    records: [],
    totalDedicated: 0,
    totalPool: 0,
  },

  onShow() {
    this.loadRecords();
  },

  onPullDownRefresh() {
    this.loadRecords().finally(() => wx.stopPullDownRefresh());
  },

  async loadRecords() {
    try {
      wx.showLoading({ title: '加载中...' });
      const { activeTab } = this.data;
      const params = { pageSize: 100 };
      if (activeTab !== 'all') params.type = activeTab;

      const res = await wx.cloud.callFunction({
        name: 'saving',
        data: { action: 'list', data: params },
      });

      const records = (res.result.data.records || []).map(r => ({
        ...r,
        saved_at_text: util.formatDateTime(r.saved_at),
        // item_name 和 item_target 由云函数 listSavings 返回（服务端查询，不受客户端权限限制）
      }));

      // 计算汇总
      let totalDedicated = 0;
      let totalPool = 0;

      for (const r of records) {
        if (r.item_id) {
          // item_name 和 item_target 由云函数返回，客户端只做 fallback
          r.item_name = r.item_name || '已删除';
        } else {
          r.item_name = '';
          r.item_target = 0;
        }

        if (r.saving_type === 'dedicated') {
          totalDedicated += r.amount;
        } else {
          totalPool += r.amount;
        }
      }

      // 对专项存款记录，按 item 分组计算该物品在列表中的总存款
      const itemTotals = {};
      for (const r of records) {
        if (r.saving_type === 'dedicated' && r.item_id) {
          itemTotals[r.item_id] = (itemTotals[r.item_id] || 0) + r.amount;
        }
      }
      for (const r of records) {
        if (r.saving_type === 'dedicated' && r.item_id) {
          r.item_total_saved = itemTotals[r.item_id] || 0;
          r.item_progress = r.item_target > 0
            ? Math.min(100, Math.round((r.item_total_saved / r.item_target) * 100))
            : 0;
        }
      }

      this.setData({ records, totalDedicated, totalPool });
    } catch (err) {
      console.error('加载存款记录失败:', err);
      util.showToast('加载失败');
    }
    wx.hideLoading();
  },

  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
    this.loadRecords();
  },

  formatMoney(num) {
    return util.formatMoney(num);
  },

  async deleteRecord(e) {
    const { id } = e.currentTarget.dataset;
    const confirmed = await util.showConfirm('删除这条存款记录？');
    if (!confirmed) return;
    try {
      await wx.cloud.callFunction({
        name: 'saving',
        data: { action: 'deleteRecord', data: { id } },
      });
      util.showToast('已删除', 'success');
      this.loadRecords();
    } catch (err) {
      console.error('删除失败:', err);
      util.showToast('删除失败，请重试');
    }
  },

  addSaving() {
    wx.showActionSheet({
      itemList: ['专项存款（选择心愿后存入）', '通用池存款'],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.navigateTo({ url: '/pages/wishlist/wishlist' });
          setTimeout(() => util.showToast('请点击心愿进入详情页存款'), 500);
        } else {
          wx.switchTab({ url: '/pages/pool/pool' });
        }
      },
    });
  },
});
