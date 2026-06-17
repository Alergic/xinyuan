// 心愿详情页逻辑
const util = require('../../utils/util.js');
const { Loader } = require('../../utils/dataLoader.js');
const app = getApp();

Page({
  data: {
    item: {},
    itemId: null,
    statusText: '',
    priorityText: '',
    categoryName: '',
    lowestPrice: null,
    totalSaved: 0,
    dedicatedSaved: 0,
    poolAllocated: 0,
    progress: 0,
    daysLeft: null,
    estimatedDays: null,
    tasks: [],
    priceRecords: [],
    savingRecords: [],
    showChart: false,
  },

  onLoad(options) {
    this.setData({ itemId: options.id });
  },

  onShow() {
    this.loadAll();
  },

  onPullDownRefresh() {
    this.loadAll().finally(() => wx.stopPullDownRefresh());
  },

  // 使用 Loader 替代 Promise.all，消除竞争条件和单点故障
  async loadAll() {
    const loader = new Loader(this, { showLoading: true, loadingTitle: '加载中...' });
    // loadSavings 依赖 loadItem 先完成（需要 item.saving_target_amount）
    loader
      .add('item',    () => this.loadItem())
      .add('savings', () => this.loadSavings(), { dependsOn: ['item'] })
      .add('tasks',   () => this.loadTasks())
      .add('prices',  () => this.loadPrices())
      .add('records', () => this.loadSavingRecords());

    const { results } = await loader.runAll();

    // item + savings 都完成后才计算预计完成日
    if (results.item && results.savings) {
      this.calcEstimatedDays();
    }
  },

  // 加载物品信息
  async loadItem() {
    const res = await wx.cloud.callFunction({
      name: 'wishlist',
      data: { action: 'get', data: { id: this.data.itemId } },
    });
    if (res.result.code !== 0) {
      util.showToast('物品不存在');
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }
    const item = res.result.data;
    const statusMap = app.globalData.statusMap;
    const priorityMap = app.globalData.priorityMap;

    let daysLeft = null;
    if (item.deadline) {
      daysLeft = util.getDaysRemaining(item.deadline);
      item.deadline_text = util.formatDate(item.deadline);
    }

    // 加载分类名称
    let categoryName = '';
    if (item.category_id && item.category_id !== 'default') {
      try {
        const db = wx.cloud.database();
        const catRes = await db.collection('category').doc(item.category_id).get();
        categoryName = catRes.data ? catRes.data.name : '';
      } catch (e) {
        // 分类可能已被删除
        categoryName = '';
      }
    }

    this.setData({
      item,
      statusText: statusMap[item.status] || item.status,
      priorityText: priorityMap[item.priority] || item.priority,
      categoryName,
      daysLeft,
    });
  },

  // 加载存款信息
  async loadSavings() {
    const res = await wx.cloud.callFunction({
      name: 'saving',
      data: { action: 'itemSavings', data: { item_id: this.data.itemId } },
    });
    const { dedicated, pool_allocated, total } = res.result.data;
    const progress = util.calcProgress(total, this.data.item.saving_target_amount);
    this.setData({
      dedicatedSaved: dedicated,
      poolAllocated: pool_allocated,
      totalSaved: total,
      progress,
    });
  },

  // 加载任务列表
  async loadTasks() {
    const res = await wx.cloud.callFunction({
      name: 'task',
      data: { action: 'list', data: { item_id: this.data.itemId } },
    });
    const tasks = (res.result.data || []).map(t => ({
      ...t,
      deadline_text: t.deadline ? util.formatDate(t.deadline) : '',
    }));
    this.setData({ tasks });
  },

  // 加载价格记录
  async loadPrices() {
    const res = await wx.cloud.callFunction({
      name: 'price',
      data: { action: 'history', data: { item_id: this.data.itemId } },
    });
    const { records, lowest_price, count, show_chart } = res.result.data;
    // 格式化时间戳
    const formatted = (records || []).map(r => ({
      ...r,
      recorded_at_text: util.formatDateTime(r.recorded_at),
    }));
    this.setData({
      priceRecords: formatted,
      lowestPrice: lowest_price,
      showChart: show_chart,
    });
  },

  // 加载存款明细（专项存款 + 通用池分配，均走云函数）
  async loadSavingRecords() {
    try {
      const itemId = this.data.itemId;

      // 并行查询专项存款和通用池分配（均通过云函数，避免客户端权限问题）
      const [savingRes, allocRes] = await Promise.all([
        wx.cloud.callFunction({
          name: 'saving',
          data: { action: 'list', data: { item_id: itemId, pageSize: 10 } },
        }),
        wx.cloud.callFunction({
          name: 'saving',
          data: { action: 'listAllocations', data: { item_id: itemId, pageSize: 10 } },
        }),
      ]);

      // 转换存款记录
      const savings = (savingRes.result.data.records || []).map(r => ({
        ...r,
        saved_at_text: util.formatDateTime(r.saved_at),
        _type: r.saving_type, // 'dedicated'
      }));

      // 转换分配记录为统一格式
      const allocations = (allocRes.result.data.records || []).map(a => ({
        _id: a._id,
        amount: a.amount,
        note: a.note || '',
        saving_type: 'allocation',
        saved_at: a.allocated_at,
        saved_at_text: util.formatDateTime(a.allocated_at),
        _type: 'allocation',
      }));

      // 合并并按时间倒序
      const allRecords = [...savings, ...allocations].sort(
        (a, b) => new Date(b.saved_at) - new Date(a.saved_at)
      );

      this.setData({ savingRecords: allRecords.slice(0, 10) });
    } catch (err) {
      console.error('加载存款明细失败:', err);
    }
  },

  // 计算预计完成日
  calcEstimatedDays() {
    const remaining = (this.data.item.saving_target_amount || 0) - this.data.totalSaved;
    if (remaining <= 0) {
      this.setData({ estimatedDays: 0 });
      return;
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const created = this.data.item.created_at ? new Date(this.data.item.created_at) : thirtyDaysAgo;
    const daysSince = Math.max(1, Math.ceil((now - created) / (1000 * 60 * 60 * 24)));
    const dailyAvg = this.data.totalSaved / daysSince;

    const estimatedDays = util.calcEstimatedDays(remaining, dailyAvg);
    this.setData({ estimatedDays });
  },

  // 格式化金额
  formatMoney(num) {
    return util.formatMoney(num);
  },

  // 更新价格弹窗（两步：价格 → 备注）
  updatePrice() {
    wx.showModal({
      title: '更新当前价格',
      editable: true,
      placeholderText: '输入最新价格',
      success: (res) => {
        if (res.confirm && res.content) {
          const price = parseFloat(res.content);
          if (isNaN(price) || price <= 0) {
            return util.showToast('请输入有效价格');
          }
          // 第二步：可选备注
          wx.showModal({
            title: '添加备注（可选）',
            editable: true,
            placeholderText: '如：需用优惠券、平台活动价等',
            success: async (res2) => {
              const confirmed = await util.showConfirm(`确认更新价格为 ¥${price.toFixed(2)}？`);
              if (!confirmed) return;
              try {
                await wx.cloud.callFunction({
                  name: 'price',
                  data: {
                    action: 'add',
                    data: {
                      item_id: this.data.itemId,
                      price,
                      note: (res2.confirm && res2.content) ? res2.content : '',
                    },
                  },
                });
                util.showToast('价格已更新', 'success');
                this.loadAll();
              } catch (err) {
                console.error('更新价格失败:', err);
                util.showToast('更新失败，请重试');
              }
            },
          });
        }
      },
    });
  },

  // 添加专项存款（两步：金额 → 备注）
  addSaving() {
    wx.showModal({
      title: '添加专项存款',
      editable: true,
      placeholderText: '输入存入金额',
      success: (res) => {
        if (res.confirm && res.content) {
          const amount = parseFloat(res.content);
          if (isNaN(amount) || amount <= 0) {
            return util.showToast('请输入有效金额');
          }
          // 第二步：可选备注
          wx.showModal({
            title: '添加备注（可选）',
            editable: true,
            placeholderText: '如：少点了一次外卖、退款到账等',
            success: async (res2) => {
              const confirmed = await util.showConfirm(`确认存入 ¥${amount.toFixed(2)}？`);
              if (!confirmed) return;
              try {
                await wx.cloud.callFunction({
                  name: 'saving',
                  data: {
                    action: 'addDedicated',
                    data: {
                      item_id: this.data.itemId,
                      amount,
                      note: (res2.confirm && res2.content) ? res2.content : '',
                    },
                  },
                });
                util.showToast(`已存入 ¥${amount.toFixed(2)}`, 'success');
                this.loadAll();
              } catch (err) {
                console.error('存款失败:', err);
                util.showToast('存入失败，请重试');
              }
            },
          });
        }
      },
    });
  },

  // 从通用池分配
  async allocateFromPool() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'saving',
        data: { action: 'poolBalance' },
      });
      const balance = res.result.data.balance;
      if (balance <= 0) {
        return util.showToast('通用池余额为 0');
      }

      wx.showModal({
        title: `通用池余额 ¥${balance.toFixed(2)}`,
        editable: true,
        placeholderText: '输入分配金额',
        success: async (modalRes) => {
          if (modalRes.confirm && modalRes.content) {
            const amount = parseFloat(modalRes.content);
            if (isNaN(amount) || amount <= 0) return util.showToast('请输入有效金额');
            if (amount > balance) return util.showToast('超过通用池余额');

            const confirmed = await util.showConfirm(`确认从通用池分配 ¥${amount.toFixed(2)}？`);
            if (!confirmed) return;

            try {
              const allocRes = await wx.cloud.callFunction({
                name: 'saving',
                data: {
                  action: 'allocate',
                  data: { item_id: this.data.itemId, amount, allocation_method: 'manual' },
                },
              });
              if (allocRes.result.code !== 0) {
                return util.showToast(allocRes.result.msg || '分配失败');
              }
              util.showToast(`已分配 ¥${amount.toFixed(2)}`, 'success');
              this.loadAll();
            } catch (err) {
              console.error('分配失败:', err);
              util.showToast('分配失败，请重试');
            }
          }
        },
      });
    } catch (err) {
      console.error('获取余额失败:', err);
      util.showToast('获取余额失败');
    }
  },

  // 添加任务
  addTask() {
    wx.showModal({
      title: '添加任务',
      editable: true,
      placeholderText: '输入任务标题',
      success: async (res) => {
        if (res.confirm && res.content) {
          try {
            await wx.cloud.callFunction({
              name: 'task',
              data: {
                action: 'add',
                data: { item_id: this.data.itemId, title: res.content },
              },
            });
            util.showToast('任务已添加', 'success');
            this.loadTasks();
          } catch (err) {
            console.error('添加任务失败:', err);
            util.showToast('添加失败，请重试');
          }
        }
      },
    });
  },

  // 切换任务完成状态
  async toggleTask(e) {
    const { id } = e.currentTarget.dataset;
    try {
      await wx.cloud.callFunction({
        name: 'task',
        data: { action: 'toggle', data: { id } },
      });
      this.loadTasks();
    } catch (err) {
      console.error('操作失败:', err);
      util.showToast('操作失败，请重试');
    }
  },

  // 删除任务
  async deleteTask(e) {
    const { id } = e.currentTarget.dataset;
    const confirmed = await util.showConfirm('删除这个任务？');
    if (!confirmed) return;
    try {
      await wx.cloud.callFunction({
        name: 'task',
        data: { action: 'delete', data: { id } },
      });
      this.loadTasks();
    } catch (err) {
      console.error('删除失败:', err);
      util.showToast('删除失败，请重试');
    }
  },

  // 编辑
  editItem() {
    wx.navigateTo({ url: `/pages/add/add?id=${this.data.itemId}` });
  },

  // 点击状态标签 → ActionSheet 切换
  changeStatus() {
    const current = this.data.item.status || 'planning';
    const statusOptions = [
      { label: '计划中', value: 'planning', desc: '继续规划，尚未开始存钱' },
      { label: '已购买', value: 'purchased', desc: '心愿已完成 🎉' },
      { label: '暂缓', value: 'paused', desc: '暂时不想买，先放一放' },
      { label: '已放弃', value: 'abandoned', desc: '不再考虑购买' },
    ];

    // 过滤掉当前状态
    const available = statusOptions.filter(o => o.value !== current);
    const labels = available.map(o => o.label);

    wx.showActionSheet({
      itemList: labels,
      success: (res) => {
        const chosen = available[res.tapIndex];
        if (chosen) this.setStatus(chosen.value, chosen.label);
      },
    });
  },

  // 统一状态变更
  async setStatus(status, label) {
    const confirmed = await util.showConfirm(`确定将状态改为"${label}"？`);
    if (!confirmed) return;
    try {
      await wx.cloud.callFunction({
        name: 'wishlist',
        data: { action: 'update', data: { id: this.data.itemId, status } },
      });

      if (status === 'purchased') {
        util.showToast('🎉 恭喜完成心愿！', 'success');
        setTimeout(() => wx.navigateBack(), 1500);
      } else if (status === 'abandoned') {
        util.showToast('已放弃');
        setTimeout(() => wx.navigateBack(), 1500);
      } else {
        util.showToast(`已改为"${label}"`, 'success');
        this.loadAll();
      }
    } catch (err) {
      console.error('状态变更失败:', err);
      util.showToast('操作失败，请重试');
    }
  },

  // 删除心愿（硬删除）
  async deleteWish() {
    const confirmed = await util.showConfirm('确定永久删除这个心愿吗？\n\n此操作不可恢复，关联的价格记录、存款记录和任务也会一并影响。');
    if (!confirmed) return;
    try {
      await wx.cloud.callFunction({
        name: 'wishlist',
        data: { action: 'delete', data: { id: this.data.itemId } },
      });
      util.showToast('已删除', 'success');
      setTimeout(() => wx.navigateBack(), 1500);
    } catch (err) {
      console.error('删除失败:', err);
      util.showToast('删除失败，请重试');
    }
  },

  // 删除价格记录
  async deletePrice(e) {
    const { id } = e.currentTarget.dataset;
    const confirmed = await util.showConfirm('删除这条价格记录？');
    if (!confirmed) return;
    try {
      await wx.cloud.callFunction({
        name: 'price',
        data: { action: 'delete', data: { id } },
      });
      util.showToast('已删除', 'success');
      this.loadPrices();
      // 价格变动可能影响 display_status，刷新全部
      this.loadAll();
    } catch (err) {
      console.error('删除价格记录失败:', err);
      util.showToast('删除失败，请重试');
    }
  },

  // 删除存款记录（专项存款或通用池分配）
  async deleteSavingRecord(e) {
    const { id, type } = e.currentTarget.dataset;
    const isAllocation = type === 'allocation';
    const msg = isAllocation ? '撤销这笔分配？资金将退回通用池。' : '删除这条存款记录？';
    const confirmed = await util.showConfirm(msg);
    if (!confirmed) return;
    try {
      await wx.cloud.callFunction({
        name: 'saving',
        data: {
          action: isAllocation ? 'deallocate' : 'deleteRecord',
          data: { id },
        },
      });
      util.showToast(isAllocation ? '已撤销' : '已删除', 'success');
      this.loadSavingRecords();
      this.loadSavings();
    } catch (err) {
      console.error('删除失败:', err);
      util.showToast('操作失败，请重试');
    }
  },

  // 编辑任务标题
  async editTask(e) {
    const { id, title } = e.currentTarget.dataset;
    wx.showModal({
      title: '编辑任务',
      editable: true,
      placeholderText: '输入新标题',
      content: title,
      success: async (res) => {
        if (res.confirm && res.content && res.content !== title) {
          try {
            await wx.cloud.callFunction({
              name: 'task',
              data: { action: 'update', data: { id, title: res.content } },
            });
            util.showToast('已更新', 'success');
            this.loadTasks();
          } catch (err) {
            console.error('编辑任务失败:', err);
            util.showToast('编辑失败，请重试');
          }
        }
      },
    });
  },
});
