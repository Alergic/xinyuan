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
    estimatedDaysWithAuto: null,  // 含定期存入的预计完成日
    tasks: [],
    priceRecords: [],
    savingRecords: [],
    displayPriceRecords: [],
    displaySavingRecords: [],
    priceRecordsExpanded: false,
    savingRecordsExpanded: false,
    autoSavePlan: null,   // 定期存入计划
    poolBalance: 0,       // 通用池余额（用于预计计算）
    showChart: false,
    priceViewMode: 'list', // 'list' | 'chart' — 价格历史展示模式
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
      .add('records', () => this.loadSavingRecords())
      .add('autoSave', () => this.loadAutoSavePlan())
      .add('balance', () => this.loadPoolBalance());

    const { results } = await loader.runAll();

    // item + savings 都完成后才计算预计完成日
    if (results.item && results.savings) {
      this.calcEstimatedDays();
    }

    // 初始折叠显示
    this.updateDisplayRecords();
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

    // 加载分类名称（通过云函数查询，避免客户端权限问题）
    let categoryName = '';
    if (item.category_id) {
      try {
        const catRes = await wx.cloud.callFunction({
          name: 'category',
          data: { action: 'list' },
        });
        const categories = catRes.result.data || [];
        const found = categories.find(c => c._id === item.category_id);
        categoryName = found ? found.name : '';
      } catch (e) {
        // 分类查询失败
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
          data: { action: 'list', data: { item_id: itemId, pageSize: 20 } },
        }),
        wx.cloud.callFunction({
          name: 'saving',
          data: { action: 'listAllocations', data: { item_id: itemId, pageSize: 20 } },
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
        item_name: a.item_name || '',
        _type: 'allocation',
      }));

      // 合并并按时间倒序（不 slice，折叠由展示层控制）
      const allRecords = [...savings, ...allocations].sort(
        (a, b) => new Date(b.saved_at) - new Date(a.saved_at)
      );

      this.setData({ savingRecords: allRecords });
    } catch (err) {
      console.error('加载存款明细失败:', err);
    }
  },

  // 计算预计完成日（含定期存入预测）
  calcEstimatedDays() {
    const targetAmount = this.data.item.saving_target_amount || 0;
    const remaining = targetAmount - this.data.totalSaved;
    if (remaining <= 0) {
      this.setData({ estimatedDays: 0, estimatedDaysWithAuto: 0 });
      return;
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const created = this.data.item.created_at ? new Date(this.data.item.created_at) : thirtyDaysAgo;
    const daysSince = Math.max(1, Math.ceil((now - created) / (1000 * 60 * 60 * 24)));
    const historicalDaily = this.data.totalSaved / daysSince;

    // 仅历史存款的预计
    const estimatedDays = util.calcEstimatedDays(remaining, historicalDaily);

    // 含定期存入的预计
    let estimatedDaysWithAuto = null;
    const plan = this.data.autoSavePlan;
    if (plan && plan.enabled) {
      const freqMap = { daily: 1, weekly: 7, monthly: 30 };
      const freqDays = freqMap[plan.frequency] || 7;
      const autoDaily = plan.amount / freqDays;

      // 考虑通用池余额上限：余额只能支撑 N 次定期存入
      const poolBalance = this.data.poolBalance;
      const maxAutoPeriods = poolBalance > 0 ? Math.floor(poolBalance / plan.amount) : 0;
      const maxAutoAmount = maxAutoPeriods * plan.amount;

      // 含定期存入的综合速度
      let combinedDaily = historicalDaily + autoDaily;

      // 如果余额不足以覆盖剩余目标，调整速度
      if (maxAutoAmount > 0 && maxAutoAmount < remaining && combinedDaily > 0) {
        // 余额够支撑的天数内的综合速度，之后降为仅历史速度
        const daysWithAuto = maxAutoPeriods * freqDays;
        const savedInAutoPeriod = combinedDaily * daysWithAuto;
        if (savedInAutoPeriod >= remaining) {
          // 在余额耗尽前就能完成
          estimatedDaysWithAuto = Math.ceil(remaining / combinedDaily);
        } else {
          // 余额耗尽后需要历史速度补完
          const afterAutoRemaining = remaining - maxAutoAmount;
          const afterAutoDays = historicalDaily > 0 ? Math.ceil(afterAutoRemaining / historicalDaily) : null;
          estimatedDaysWithAuto = afterAutoDays !== null ? daysWithAuto + afterAutoDays : null;
        }
      } else if (combinedDaily > 0) {
        estimatedDaysWithAuto = Math.ceil(remaining / combinedDaily);
      }
    }

    this.setData({ estimatedDays, estimatedDaysWithAuto });
  },

  // 更新展示列表（折叠逻辑）
  updateDisplayRecords() {
    const { priceRecords, priceRecordsExpanded, savingRecords, savingRecordsExpanded } = this.data;
    this.setData({
      displayPriceRecords: priceRecordsExpanded ? priceRecords : priceRecords.slice(0, 3),
      displaySavingRecords: savingRecordsExpanded ? savingRecords : savingRecords.slice(0, 3),
    });
  },

  togglePriceRecords() {
    this.setData({ priceRecordsExpanded: !this.data.priceRecordsExpanded });
    this.updateDisplayRecords();
  },

  toggleSavingRecords() {
    this.setData({ savingRecordsExpanded: !this.data.savingRecordsExpanded });
    this.updateDisplayRecords();
  },

  // 切换价格展示模式（列表 / 趋势图）
  togglePriceView() {
    const newMode = this.data.priceViewMode === 'list' ? 'chart' : 'list';
    this.setData({ priceViewMode: newMode });
    if (newMode === 'chart') {
      // 延迟绘制，等 canvas 渲染完成
      setTimeout(() => this.drawPriceChart(), 300);
    }
  },

  // 绘制价格趋势图（Canvas 2D）
  drawPriceChart() {
    const query = wx.createSelectorQuery().in(this);
    query.select('#priceChart')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res[0] || !res[0].node) return;
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const width = res[0].width;
        const height = res[0].height;
        const dpr = wx.getSystemInfoSync().pixelRatio;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        const records = [...this.data.priceRecords].reverse(); // 旧→新
        const prices = records.map(r => r.price);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const priceRange = maxPrice - minPrice || 1;
        const padding = { top: 20, right: 20, bottom: 40, left: 50 };
        const chartW = width - padding.left - padding.right;
        const chartH = height - padding.top - padding.bottom;

        // 清空
        ctx.clearRect(0, 0, width, height);

        // 背景网格
        ctx.strokeStyle = '#EEE';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 4; i++) {
          const y = padding.top + (chartH / 4) * i;
          ctx.beginPath();
          ctx.moveTo(padding.left, y);
          ctx.lineTo(width - padding.right, y);
          ctx.stroke();
          // Y 轴标签
          const val = maxPrice - (priceRange / 4) * i;
          ctx.fillStyle = '#999';
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText('¥' + val.toFixed(0), padding.left - 6, y + 3);
        }

        // 折线
        ctx.strokeStyle = '#5C6BC0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        records.forEach((r, i) => {
          const x = padding.left + (chartW / (records.length - 1 || 1)) * i;
          const y = padding.top + chartH - ((r.price - minPrice) / priceRange) * chartH;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // 目标价格虚线（如果有）
        const targetPrice = this.data.item.target_price;
        if (targetPrice && targetPrice >= minPrice && targetPrice <= maxPrice) {
          const targetY = padding.top + chartH - ((targetPrice - minPrice) / priceRange) * chartH;
          ctx.strokeStyle = '#66BB6A';
          ctx.lineWidth = 1;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(padding.left, targetY);
          ctx.lineTo(width - padding.right, targetY);
          ctx.stroke();
          ctx.setLineDash([]); // 重置

          // 目标价标签
          ctx.fillStyle = '#66BB6A';
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText('目标 ¥' + targetPrice.toFixed(0), width - padding.right - 60, targetY - 6);
        }

        // 数据点
        records.forEach((r, i) => {
          const x = padding.left + (chartW / (records.length - 1 || 1)) * i;
          const y = padding.top + chartH - ((r.price - minPrice) / priceRange) * chartH;
          const isLowest = r.price === minPrice;
          const isLatest = i === records.length - 1;

          ctx.beginPath();
          ctx.arc(x, y, isLowest || isLatest ? 5 : 3, 0, Math.PI * 2);
          ctx.fillStyle = isLowest ? '#EF5350' : (isLatest ? '#5C6BC0' : '#FFF');
          ctx.fill();
          ctx.strokeStyle = isLowest ? '#EF5350' : '#5C6BC0';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          // 最高/最低标注
          if (isLowest && records.length > 1) {
            ctx.fillStyle = '#EF5350';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('史低 ¥' + r.price.toFixed(0), x, y - 10);
          }
        });

        // X 轴日期标签（抽稀）
        const maxLabels = 5;
        const step = Math.max(1, Math.floor(records.length / maxLabels));
        ctx.fillStyle = '#999';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        records.forEach((r, i) => {
          if (i % step === 0 || i === records.length - 1) {
            const x = padding.left + (chartW / (records.length - 1 || 1)) * i;
            const dateStr = (r.recorded_at_text || '').slice(5); // MM-DD
            ctx.fillText(dateStr, x, height - 6);
          }
        });
      });
  },

  // 加载定期存入计划
  async loadAutoSavePlan() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'saving',
        data: { action: 'getAutoSavePlan', data: { item_id: this.data.itemId } },
      });
      if (res.result.code === 0) {
        const plan = res.result.data.plan;
        if (plan && plan.last_executed_at) {
          plan.last_executed_at_text = util.formatDateTime(plan.last_executed_at);
        }
        this.setData({ autoSavePlan: plan });
      }
    } catch (err) {
      console.error('加载定期存入计划失败:', err);
    }
  },

  // 加载通用池余额
  async loadPoolBalance() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'saving',
        data: { action: 'poolBalance' },
      });
      if (res.result.code === 0) {
        this.setData({ poolBalance: res.result.data.balance || 0 });
      }
    } catch (err) {
      console.error('加载通用池余额失败:', err);
    }
  },

  // 设置/修改定期存入计划
  setupAutoSave() {
    const existingPlan = this.data.autoSavePlan;
    const defaultAmount = existingPlan ? String(existingPlan.amount) : '';
    const title = existingPlan && existingPlan.enabled ? '修改定期存入计划' : '设置定期存入计划';

    wx.showModal({
      title,
      editable: true,
      placeholderText: '每次存入金额',
      content: defaultAmount,
      success: (res) => {
        if (res.confirm && res.content) {
          const amount = parseFloat(res.content);
          if (isNaN(amount) || amount <= 0) return util.showToast('请输入有效金额');

          // 第二步：选择周期
          wx.showActionSheet({
            itemList: ['每天', '每周', '每月'],
            success: async (sheetRes) => {
              const freqMap = { 0: 'daily', 1: 'weekly', 2: 'monthly' };
              const freqLabels = { daily: '每天', weekly: '每周', monthly: '每月' };
              const frequency = freqMap[sheetRes.tapIndex];
              const freqLabel = freqLabels[frequency];

              const confirmed = await util.showConfirm(
                `确定设置定期存入：${freqLabel}从通用池存入 ¥${amount.toFixed(2)}？`
              );
              if (!confirmed) return;

              try {
                const saveRes = await wx.cloud.callFunction({
                  name: 'saving',
                  data: {
                    action: 'setAutoSave',
                    data: { item_id: this.data.itemId, amount, frequency },
                  },
                });
                if (saveRes.result.code !== 0) {
                  return util.showToast(saveRes.result.msg || '设置失败');
                }
                util.showToast('已设置', 'success');
                this.loadAutoSavePlan();
                this.loadPoolBalance().then(() => this.calcEstimatedDays());
              } catch (err) {
                console.error('设置定期存入失败:', err);
                util.showToast('设置失败，请重试');
              }
            },
          });
        }
      },
    });
  },

  // 停用定期存入计划
  async disableAutoSavePlan() {
    const confirmed = await util.showConfirm('停用定期存入计划？\n\n停用后不会自动执行，可随时重新开启。');
    if (!confirmed) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'saving',
        data: { action: 'disableAutoSave', data: { item_id: this.data.itemId } },
      });
      if (res.result.code !== 0) {
        return util.showToast(res.result.msg || '停用失败');
      }
      util.showToast('已停用', 'success');
      this.loadAutoSavePlan();
      this.loadPoolBalance().then(() => this.calcEstimatedDays());
    } catch (err) {
      console.error('停用失败:', err);
      util.showToast('停用失败，请重试');
    }
  },

  // 手动执行本期定期存入
  async executeAutoSaveNow() {
    const confirmed = await util.showConfirm(
      `立即执行一次定期存入：从通用池分配 ¥${this.data.autoSavePlan.amount.toFixed(2)} 到此心愿？`
    );
    if (!confirmed) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'saving',
        data: { action: 'executeAutoSave', data: { item_id: this.data.itemId } },
      });
      if (res.result.code !== 0) {
        return util.showToast(res.result.msg || '执行失败');
      }
      util.showToast(res.result.msg || '已存入', 'success');
      // 刷新存款数据和计划
      this.loadAll();
    } catch (err) {
      console.error('执行定期存入失败:', err);
      util.showToast('执行失败，请重试');
    }
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
  // 点击图片预览大图
  previewImage(e) {
    const url = e.currentTarget.dataset.url;
    const urls = this.data.item.image_urls && this.data.item.image_urls.length > 0
      ? this.data.item.image_urls
      : (this.data.item.image_url ? [this.data.item.image_url] : [url]);
    wx.previewImage({
      current: url,
      urls,
    });
  },

  // 切换分类
  async changeCategory() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'category',
        data: { action: 'list' },
      });
      const categories = res.result.data || [];
      if (categories.length === 0) {
        util.showToast('暂无分类，请先创建');
        return;
      }
      const labels = categories.map(c => c.name);
      wx.showActionSheet({
        itemList: labels,
        success: async (res2) => {
          const chosen = categories[res2.tapIndex];
          if (chosen && chosen._id !== this.data.item.category_id) {
            try {
              await wx.cloud.callFunction({
                name: 'wishlist',
                data: { action: 'update', data: { id: this.data.itemId, category_id: chosen._id } },
              });
              this.setData({ categoryName: chosen.name });
              util.showToast(`已改为「${chosen.name}」`, 'success');
            } catch (err) {
              util.showToast('更新失败');
            }
          }
        },
      });
    } catch (err) {
      util.showToast('加载分类失败');
    }
  },

  // 切换优先级
  changePriority() {
    const current = this.data.item.priority || 'medium';
    const options = [
      { label: '🔴 高优先级', value: 'high' },
      { label: '🟠 中优先级', value: 'medium' },
      { label: '🔵 低优先级', value: 'low' },
    ];
    const available = options.filter(o => o.value !== current);
    const labels = available.map(o => o.label);

    wx.showActionSheet({
      itemList: labels,
      success: async (res) => {
        const chosen = available[res.tapIndex];
        if (!chosen) return;
        try {
          await wx.cloud.callFunction({
            name: 'wishlist',
            data: { action: 'update', data: { id: this.data.itemId, priority: chosen.value } },
          });
          const item = this.data.item;
          item.priority = chosen.value;
          const priorityMap = { high: '高', medium: '中', low: '低' };
          this.setData({ item, priorityText: priorityMap[chosen.value] });
          util.showToast(`优先级已改为「${chosen.label}」`, 'success');
        } catch (err) {
          util.showToast('更新失败');
        }
      },
    });
  },

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
      this.loadSavingRecords().then(() => this.updateDisplayRecords());
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
