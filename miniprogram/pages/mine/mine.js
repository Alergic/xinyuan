// 我的页面逻辑
const util = require('../../utils/util.js');
const app = getApp();

Page({
  data: {
    avatarUrl: '',
    nickname: '',
    stats: {
      total_wishes: 0,
      pool_balance: 0,
    },
  },

  onShow() {
    this.loadUserInfo();
    this.loadStats();
  },

  loadUserInfo() {
    this.setData({
      avatarUrl: app.globalData.userInfo?.avatarUrl || '',
      nickname: app.globalData.userInfo?.nickName || '',
    });
  },

  async loadStats() {
    try {
      const res = await wx.cloud.callFunction({ name: 'stats' });
      this.setData({ stats: res.result.data });
    } catch (err) {
      console.error('加载统计失败:', err);
    }
  },

  formatMoney(num) {
    return util.formatMoney(num);
  },

  goWishlist() {
    wx.switchTab({ url: '/pages/wishlist/wishlist' });
  },
  goSavings() {
    wx.navigateTo({ url: '/pages/savings/savings' });
  },
  goPool() {
    wx.switchTab({ url: '/pages/pool/pool' });
  },
  goStats() {
    wx.switchTab({ url: '/pages/stats/stats' });
  },
  goCategory() {
    wx.navigateTo({ url: '/pages/category/category' });
  },
  showComingSoon() {
    wx.showToast({ title: '即将推出，敬请期待', icon: 'none' });
  },
  showAbout() {
    wx.showModal({
      title: '关于心愿计划',
      content: '心愿计划 v1.0.0\n\n帮助你记录想买的物品、追踪价格变化、管理存款进度。\n\n每一步，都离想要的生活更近。',
      showCancel: false,
      confirmText: '知道了',
    });
  },
});
