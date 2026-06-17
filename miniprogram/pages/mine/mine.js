// 我的页面逻辑
const util = require('../../utils/util.js');
const app = getApp();

Page({
  data: {
    avatarUrl: '',
    nickname: '',
    signature: '',
    reminderSubscribed: false,
    stats: {
      total_wishes: 0,
      pool_balance: 0,
    },
  },

  onShow() {
    this.loadUserInfo();
    this.loadStats();
  },

  async loadUserInfo() {
    // 1. 尝试从云端加载资料（跨设备同步）
    let cloudProfile = null;
    try {
      const res = await wx.cloud.callFunction({
        name: 'login',
        data: { action: 'getProfile' },
      });
      if (res.result && res.result.code === 0) {
        cloudProfile = res.result.data.profile;
      }
    } catch (e) {
      console.error('云端加载资料失败:', e);
    }

    // 2. 本地缓存作为 fallback
    const cached = wx.getStorageSync('userProfile');

    // 3. 合并：云端优先，本地兜底
    const avatarUrl = cloudProfile?.avatarUrl || cached?.avatarUrl || app.globalData.userInfo?.avatarUrl || '';
    const nickname = cloudProfile?.nickname || cached?.nickname || app.globalData.userInfo?.nickName || '';
    const signature = cloudProfile?.signature || cached?.signature || '';
    const reminderSubscribed = wx.getStorageSync('reminderSubscribed') || false;

    this.setData({ avatarUrl, nickname, signature, reminderSubscribed });

    // 同步到本地缓存 + globalData
    wx.setStorageSync('userProfile', { avatarUrl, nickname, signature });
    app.globalData.userInfo = { ...app.globalData.userInfo, avatarUrl, nickName: nickname };
  },

  // 选择头像
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    // 上传到云存储
    wx.showLoading({ title: '上传中...' });
    wx.cloud.uploadFile({
      cloudPath: `avatars/${Date.now()}_${Math.random().toString(36).substring(2, 8)}.jpg`,
      filePath: avatarUrl,
      success: (res) => {
        wx.hideLoading();
        const cloudUrl = res.fileID;
        this.setData({ avatarUrl: cloudUrl });
        this.saveProfile({ avatarUrl: cloudUrl });
        util.showToast('头像已更新', 'success');
      },
      fail: (err) => {
        wx.hideLoading();
        console.error('头像上传失败:', err);
        // 上传失败也用本地临时路径
        this.setData({ avatarUrl });
        this.saveProfile({ avatarUrl });
      },
    });
  },

  // 保存昵称
  onNicknameSave(e) {
    const nickname = e.detail.value;
    if (nickname && nickname.trim()) {
      this.setData({ nickname: nickname.trim() });
      this.saveProfile({ nickname: nickname.trim() });
    }
  },

  // 保存个性签名
  onSignatureSave(e) {
    const signature = e.detail.value;
    this.setData({ signature });
    this.saveProfile({ signature });
  },

  // 持久化用户信息到本地缓存 + 云端
  async saveProfile(updates) {
    const cached = wx.getStorageSync('userProfile') || {};
    const merged = { ...cached, ...updates };
    wx.setStorageSync('userProfile', merged);
    app.globalData.userInfo = { ...app.globalData.userInfo, avatarUrl: merged.avatarUrl, nickName: merged.nickname };

    // 异步同步到云端（不阻塞 UI）
    try {
      await wx.cloud.callFunction({
        name: 'login',
        data: { action: 'saveProfile', data: merged },
      });
    } catch (e) {
      console.error('云端保存资料失败:', e);
    }
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
  goTags() {
    wx.navigateTo({ url: '/pages/tags/tags' });
  },
  showComingSoon() {
    wx.showToast({ title: '即将推出，敬请期待', icon: 'none' });
  },
  // 订阅 Deadline 提醒
  subscribeReminder() {
    // 模板 ID 在云函数 notify/index.js 中配置
    wx.requestSubscribeMessage({
      tmplIds: ['YOUR_TEMPLATE_ID_HERE'],
      success: (res) => {
        // res[templateId] === 'accept' 表示用户同意
        const accepted = Object.values(res).some(v => v === 'accept');
        if (accepted) {
          this.setData({ reminderSubscribed: true });
          wx.setStorageSync('reminderSubscribed', true);
          util.showToast('订阅成功', 'success');
        } else {
          util.showToast('已取消订阅');
        }
      },
      fail: () => {
        util.showToast('订阅失败，请在设置中开启');
      },
    });
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
