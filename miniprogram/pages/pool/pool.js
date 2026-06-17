// 通用存款池页逻辑
const util = require('../../utils/util.js');
const { Loader } = require('../../utils/dataLoader.js');

Page({
  data: {
    poolBalance: 0,
    totalPoolIn: 0,
    totalAllocated: 0,
    records: [],
    allocations: [],
    wishItems: [],
    wishNames: [],
    selectedWishId: null,
    selectedWishName: '',
    allocAmount: '',
    showAllocate: false,
  },

  onShow() {
    this.loadAll();
  },

  onPullDownRefresh() {
    this.loadAll().finally(() => wx.stopPullDownRefresh());
  },

  // 使用 Loader 替代 Promise.all，独立错误处理
  async loadAll() {
    const loader = new Loader(this, { showLoading: true, loadingTitle: '加载中...' });
    loader
      .add('records',     () => this.loadRecords())
      .add('allocations', () => this.loadAllocations())
      .add('wishItems',   () => this.loadWishItems())
      .add('balance',     () => this.loadBalance());
      // balance 独立计算，不依赖其他任务的中间状态
    await loader.runAll();
  },

  // 加载余额（使用 stats 云函数获取精确值）
  async loadBalance() {
    const statsRes = await wx.cloud.callFunction({ name: 'stats' });
    const stats = statsRes.result.data;
    this.setData({
      poolBalance: stats.pool_balance || 0,
    });
  },

  // 加载通用池存款记录（在此计算 totalPoolIn）
  async loadRecords() {
    const res = await wx.cloud.callFunction({
      name: 'saving',
      data: { action: 'list', data: { type: 'pool', pageSize: 50 } },
    });
    const records = (res.result.data.records || []).map(r => ({
      ...r,
      saved_at_text: util.formatDateTime(r.saved_at),
    }));
    const totalPoolIn = records.reduce((sum, r) => sum + r.amount, 0);
    this.setData({ records, totalPoolIn });
  },

  // 加载分配记录（通过云函数查询，已含 item_name）
  async loadAllocations() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'saving',
        data: { action: 'listAllocations', data: { pageSize: 50 } },
      });

      const allocations = (res.result.data.records || []).map(a => ({
        ...a,
        allocated_at_text: util.formatDateTime(a.allocated_at),
        item_name: a.item_name || '已删除',
      }));

      const totalAllocated = allocations.reduce((sum, a) => sum + a.amount, 0);

      this.setData({ allocations, totalAllocated });
    } catch (err) {
      console.error('加载分配记录失败:', err);
    }
  },

  // 加载心愿物品列表（用于分配选择）
  async loadWishItems() {
    const res = await wx.cloud.callFunction({
      name: 'wishlist',
      data: { action: 'list', data: { status: 'all', pageSize: 100 } },
    });
    const items = (res.result.data.items || []).filter(
      i => i.status !== 'purchased' && i.status !== 'abandoned'
    );
    this.setData({
      wishItems: items,
      wishNames: items.map(i => i.name),
    });
  },

  // 格式化金额
  formatMoney(num) {
    return util.formatMoney(num);
  },

  // 存入通用池
  async addPoolSaving() {
    wx.showModal({
      title: '存入通用存款池',
      editable: true,
      placeholderText: '输入存入金额',
      success: async (res) => {
        if (res.confirm && res.content) {
          const amount = parseFloat(res.content);
          if (isNaN(amount) || amount <= 0) {
            return util.showToast('请输入有效金额');
          }
          const confirmed = await util.showConfirm(`确认存入 ¥${amount.toFixed(2)} 到通用池？`);
          if (!confirmed) return;
          try {
            await wx.cloud.callFunction({
              name: 'saving',
              data: { action: 'addPool', data: { amount } },
            });
            util.showToast('已存入通用池', 'success');
            this.loadAll();
          } catch (err) {
            console.error('存入失败:', err);
            util.showToast('存入失败，请重试');
          }
        }
      },
    });
  },

  // 显示分配面板
  allocate() {
    if (this.data.poolBalance <= 0) {
      return util.showToast('通用池余额为 0');
    }
    this.setData({ showAllocate: true });
  },

  // 选择心愿物品
  onWishSelect(e) {
    const index = parseInt(e.detail.value);
    this.setData({
      selectedWishId: this.data.wishItems[index]._id,
      selectedWishName: this.data.wishItems[index].name,
    });
  },

  // 输入分配金额
  onAllocInput(e) {
    this.setData({ allocAmount: e.detail.value });
  },

  // 确认分配
  async confirmAllocate() {
    if (!this.data.selectedWishId) {
      return util.showToast('请选择心愿物品');
    }
    const amount = parseFloat(this.data.allocAmount);
    if (isNaN(amount) || amount <= 0) {
      return util.showToast('请输入有效金额');
    }
    if (amount > this.data.poolBalance) {
      return util.showToast('超过通用池余额');
    }

    try {
      const allocRes = await wx.cloud.callFunction({
        name: 'saving',
        data: {
          action: 'allocate',
          data: {
            item_id: this.data.selectedWishId,
            amount,
            allocation_method: 'manual',
          },
        },
      });
      if (allocRes.result.code !== 0) {
        return util.showToast(allocRes.result.msg || '分配失败');
      }
      util.showToast('分配成功', 'success');
      this.setData({
        showAllocate: false,
        selectedWishId: null,
        selectedWishName: '',
        allocAmount: '',
      });
      this.loadAll();
    } catch (err) {
      console.error('分配失败:', err);
      util.showToast('分配失败，请重试');
    }
  },

  cancelAllocate() {
    this.setData({ showAllocate: false });
  },

  // 删除通用池存款记录
  async deletePoolRecord(e) {
    const { id } = e.currentTarget.dataset;
    const confirmed = await util.showConfirm('删除这条通用池存款记录？');
    if (!confirmed) return;
    try {
      await wx.cloud.callFunction({
        name: 'saving',
        data: { action: 'deleteRecord', data: { id } },
      });
      util.showToast('已删除', 'success');
      this.loadAll();
    } catch (err) {
      console.error('删除失败:', err);
      util.showToast('删除失败，请重试');
    }
  },

  // 撤销分配（资金退回通用池）
  async undoAllocation(e) {
    const { id } = e.currentTarget.dataset;
    const confirmed = await util.showConfirm('撤销这笔分配？\n\n资金将退回通用池。');
    if (!confirmed) return;
    try {
      await wx.cloud.callFunction({
        name: 'saving',
        data: { action: 'deallocate', data: { id } },
      });
      util.showToast('已撤销', 'success');
      this.loadAll();
    } catch (err) {
      console.error('撤销失败:', err);
      util.showToast('撤销失败，请重试');
    }
  },
});
