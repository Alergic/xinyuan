// 首页逻辑
const util = require('../../utils/util.js');
const app = getApp();

Page({
  data: {
    stats: {
      total_wishes: 0,
      saving_count: 0,
      buyable_count: 0,
      purchased_count: 0,
      total_target_amount: 0,
      total_saved_amount: 0,
      pool_balance: 0,
    },
    topProgressItem: null,
    nearDeadlineItem: null,
    priceReachedItem: null,
    loading: true,
  },

  onShow() {
    this.loadData();
  },

  onPullDownRefresh() {
    this.loadData().finally(() => wx.stopPullDownRefresh());
  },

  // 加载首页数据
  async loadData() {
    wx.showLoading({ title: '加载中...' });
    let stats = this.data.stats;
    let items = [];

    // 分别调用，避免一个失败拖垮全部
    try {
      const statsRes = await wx.cloud.callFunction({ name: 'stats' });
      console.log('stats 云函数返回:', statsRes);
      if (statsRes.result && statsRes.result.code === 0) {
        stats = statsRes.result.data;
      } else {
        console.error('stats 返回异常:', statsRes);
      }
    } catch (err) {
      console.error('stats 云函数调用失败:', err);
    }

    try {
      const wishlistRes = await wx.cloud.callFunction({
        name: 'wishlist',
        data: { action: 'listEnriched', data: { pageSize: 50 } },
      });
      console.log('wishlist 云函数返回:', wishlistRes);
      if (wishlistRes.result && wishlistRes.result.code === 0) {
        items = wishlistRes.result.data.items || [];
      } else {
        console.error('wishlist 返回异常:', wishlistRes);
      }
    } catch (err) {
      console.error('wishlist 云函数调用失败:', err);
    }

    this.setData({ stats, loading: false });
    this.processHighlights(items);
    wx.hideLoading();
  },

  // 处理重点心愿数据
  processHighlights(items) {
    if (!items || items.length === 0) return;

    const usedIds = new Set(); // 去重：同一心愿不出现在多个卡片中

    // 为每个物品计算进度和存款
    const enriched = items.map(item => {
      const progress = item.saving_target_amount > 0
        ? Math.round(((item.total_saved || 0) / item.saving_target_amount) * 100)
        : 0;
      return { ...item, progress };
    });

    // 1. 进度最高的物品（进度 > 0 且未购买/未放弃）
    const sortedByProgress = [...enriched]
      .filter(i => i.progress > 0 && i.status !== 'purchased' && i.status !== 'abandoned')
      .sort((a, b) => b.progress - a.progress);
    const topProgressItem = sortedByProgress[0] || null;
    if (topProgressItem) usedIds.add(topProgressItem._id);

    // 2. 临近 deadline 的物品（排除已使用的）
    const withDeadline = enriched
      .filter(i => i.deadline && !usedIds.has(i._id) && i.status !== 'purchased' && i.status !== 'abandoned')
      .map(i => ({
        ...i,
        days_left: util.getDaysRemaining(i.deadline),
        deadline_text: util.formatDate(i.deadline),
      }))
      .sort((a, b) => a.days_left - b.days_left);
    const nearDeadlineItem = withDeadline.length > 0 ? withDeadline[0] : null;
    if (nearDeadlineItem) usedIds.add(nearDeadlineItem._id);

    // 3. 当前价格达到或低于目标价格的物品（排除已使用的）
    const priceReachedItem = enriched.find(
      i => !usedIds.has(i._id) && i.target_price && i.current_price <= i.target_price && i.status !== 'purchased'
    );

    this.setData({
      topProgressItem: topProgressItem || null,
      nearDeadlineItem: nearDeadlineItem || null,
      priceReachedItem: priceReachedItem || null,
    });
  },

  // 格式化金额
  formatMoney(num) {
    return util.formatMoney(num);
  },

  // 快捷操作跳转
  goAddWish() {
    wx.navigateTo({ url: '/pages/add/add' });
  },
  goAddSaving() {
    wx.navigateTo({ url: '/pages/savings/savings' });
  },
  goUpdatePrice() {
    wx.switchTab({ url: '/pages/wishlist/wishlist' });
  },
  goPool() {
    wx.switchTab({ url: '/pages/pool/pool' });
  },
  // 跳转统计
  goStats() {
    wx.switchTab({ url: '/pages/stats/stats' });
  },
  // 跳转心愿列表
  goWishlist() {
    wx.switchTab({ url: '/pages/wishlist/wishlist' });
  },
  // 跳转心愿列表并筛选
  goWishlistFilter(e) {
    const filter = e.currentTarget.dataset.filter;
    const filterLabels = { saving: '存款中', buyable: '可购买', purchased: '已购买' };
    app.globalData.pendingWishlistFilter = {
      filter,
      label: filterLabels[filter] || filter,
    };
    wx.switchTab({ url: '/pages/wishlist/wishlist' });
  },
  // 跳转详情
  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },
});
