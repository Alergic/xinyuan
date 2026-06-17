// ============================================
// 心愿计划 - 小程序入口文件
// ============================================
App({
  /**
   * 小程序启动时执行
   */
  onLaunch: function () {
    // 1. 初始化云开发环境
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        // env 参数说明：
        //   env 参数决定云开发的资源环境
        //   如不填则使用默认环境（第一个创建的环境）
        //   如果填写，则使用指定环境
        env: 'cloudbase-d0gv1flgf0f5d2bbd', // 替换为你的云开发环境 ID
        traceUser: true,
      });
    }

    // 2. 获取用户信息（云开发方式）
    this.getOpenId();
  },

  /**
   * 全局数据
   */
  globalData: {
    userInfo: null,
    openid: null,
    // 分类颜色映射
    categoryColors: {
      '数码': '#4A90D9',
      '服饰': '#E85D75',
      '美妆': '#F5A623',
      '家居': '#7ED321',
      '书籍': '#B8A05E',
      '课程': '#50C1E9',
      '旅行': '#5C6BC0',
      '礼物': '#EC407A',
      '其他': '#9E9E9E',
    },
    // 状态文本映射
    statusMap: {
      'planning': '计划中',
      'saving': '存款中',
      'buyable': '可购买',
      'purchased': '已购买',
      'abandoned': '已放弃',
      'paused': '暂缓',
      'overdue': '已逾期',
    },
    // 分类筛选缓存（分类页跳转 wishlist 时使用）
    pendingCategoryFilter: null, // { category_id, category_name }
    // 首页筛选跳转（首页状态卡片跳转 wishlist 时使用）
    pendingWishlistFilter: null, // { filter, label }
    // 优先级文本映射
    priorityMap: {
      'high': '高',
      'medium': '中',
      'low': '低',
    },
  },

  /**
   * 获取用户 openid（云函数方式，无需后端服务器）
   */
  getOpenId: function (retryCount) {
    const that = this;
    const maxRetries = retryCount != null ? retryCount : 3;
    let attempts = 0;

    const tryLogin = () => {
      attempts++;
      wx.cloud.callFunction({
        name: 'login',
        success: res => {
          if (res.result && res.result.openid) {
            that.globalData.openid = res.result.openid;
            console.log('登录成功, openid:', res.result.openid);
          } else if (attempts < maxRetries) {
            console.warn(`登录返回异常，第${attempts}次重试...`);
            setTimeout(tryLogin, 1000 * attempts);
          } else {
            console.error('登录失败：已达最大重试次数');
            // 延迟重试 — 给用户机会手动刷新
            setTimeout(() => that.getOpenId(1), 5000);
          }
        },
        fail: err => {
          console.error(`登录失败 (${attempts}/${maxRetries}):`, err);
          if (attempts < maxRetries) {
            setTimeout(tryLogin, 1500 * attempts);
          } else {
            console.error('登录失败：已达最大重试次数');
            // 提示用户检查网络
            wx.showToast({ title: '网络异常，请稍后重试', icon: 'none', duration: 3000 });
            setTimeout(() => that.getOpenId(1), 8000);
          }
        }
      });
    };
    tryLogin();
  },
});
