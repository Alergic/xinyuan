// 心愿列表页逻辑
const util = require('../../utils/util.js');
const app = getApp();

Page({
  data: {
    items: [],
    categories: [],
    activeFilter: null,
    filters: {
      status: 'all',
      category_id: 'all',
      sort: 'updated_at',
      order: 'desc',
    },
    searchText: '',
    searchKeyword: '',
    searchTimer: null,
    statusLabel: '全部状态',
    categoryLabel: '全部分类',
    sortLabel: '最近更新',
  },

  onShow() {
    this.loadCategories();

    // 检查是否有来自分类页的筛选请求
    let hasPendingFilter = false;
    const pending = app.globalData.pendingCategoryFilter;
    if (pending) {
      app.globalData.pendingCategoryFilter = null;
      hasPendingFilter = true;
      this.setData({
        'filters.category_id': pending.category_id,
        categoryLabel: pending.category_name,
      });
    }

    // 检查是否有来自首页状态卡片的筛选请求
    const pendingFilter = app.globalData.pendingWishlistFilter;
    if (pendingFilter) {
      app.globalData.pendingWishlistFilter = null;
      hasPendingFilter = true;
      const statusLabels = { saving: '存款中', buyable: '可购买', purchased: '已购买' };
      this.setData({
        'filters.status': pendingFilter.filter,
        statusLabel: statusLabels[pendingFilter.filter] || pendingFilter.label,
      });
    }

    // 有 pending filter 时延迟一帧再加载，确保 setData 已提交到 this.data
    if (hasPendingFilter) {
      wx.nextTick(() => this.loadItems());
    } else {
      this.loadItems();
    }
  },

  onPullDownRefresh() {
    Promise.all([this.loadCategories(), this.loadItems()])
      .finally(() => wx.stopPullDownRefresh());
  },

  // 加载分类列表
  async loadCategories() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'category',
        data: { action: 'list' },
      });
      this.setData({ categories: res.result.data || [] });
    } catch (err) {
      console.error('加载分类失败:', err);
    }
  },

  // 加载物品列表（使用 listEnriched 一次获取全部数据，替代 N+1）
  async loadItems() {
    wx.showLoading({ title: '加载中...' });
    try {
      const filters = this.data.filters;

      // 排序映射
      // display_status 派生值（planning/saving/buyable/overdue）由服务端 listItemsEnriched 计算并筛选
      const serverFilters = { ...filters };
      if (serverFilters.sort === 'current_price_asc') {
        serverFilters.sort = 'current_price';
        serverFilters.order = 'asc';
      } else {
        serverFilters.order = 'desc';
      }

      const res = await wx.cloud.callFunction({
        name: 'wishlist',
        data: {
          action: 'listEnriched',
          data: {
            ...serverFilters,
            keyword: this.data.searchKeyword,
          },
        },
      });

      let items = res.result.data.items || [];

      // 客户端轻量后处理：只做 WXML 展示需要的文本映射
      // progress / display_status 由服务端 listItemsEnriched 统一计算并返回
      // 派生状态筛选（planning/saving/buyable/overdue）也由服务端完成
      const statusMap = app.globalData.statusMap;
      const priorityMap = app.globalData.priorityMap;
      for (let item of items) {
        item.status_text = statusMap[item.display_status] || statusMap[item.status] || item.status;
        item.priority_text = priorityMap[item.priority] || '';
        if (item.deadline) {
          item.days_left = util.getDaysRemaining(item.deadline);
          item.deadline_text = util.formatDate(item.deadline);
        }
      }

      this.setData({ items, activeFilter: null });
    } catch (err) {
      console.error('加载列表失败:', err);
      util.showToast('加载失败');
    }
    wx.hideLoading();
  },

  // 状态文本
  statusText(status) {
    return app.globalData.statusMap[status] || status;
  },

  // 格式化金额
  formatMoney(num) {
    return util.formatMoney(num);
  },

  // 显示筛选面板
  showFilter(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({
      activeFilter: this.data.activeFilter === type ? null : type,
    });
  },

  // 应用筛选
  onFilter(e) {
    const { key, value } = e.currentTarget.dataset;
    const filters = { ...this.data.filters, [key]: value };
    this.setData({ filters, activeFilter: null });

    // 更新标签
    const statusLabels = {
      all: '全部状态', planning: '计划中', saving: '存款中',
      buyable: '可购买', purchased: '已购买', overdue: '已逾期',
      abandoned: '已放弃', paused: '暂缓',
    };
    const sortLabels = {
      updated_at: '最近更新', created_at: '最近添加',
      deadline: 'Deadline 最近', current_price: '价格最高',
      current_price_asc: '价格最低',
    };
    if (key === 'status') this.setData({ statusLabel: statusLabels[value] || '全部状态' });
    if (key === 'category_id') {
      const cat = this.data.categories.find(c => c._id === value);
      this.setData({ categoryLabel: cat ? cat.name : '全部分类' });
    }
    if (key === 'sort') this.setData({ sortLabel: sortLabels[value] || '最近更新' });

    this.loadItems();
  },

  // 搜索输入（500ms 防抖）
  onSearchInput(e) {
    const value = e.detail.value;
    this.setData({ searchText: value });

    if (this.data.searchTimer) clearTimeout(this.data.searchTimer);
    this.data.searchTimer = setTimeout(() => {
      this.setData({ searchKeyword: value });
      this.loadItems();
    }, 500);
  },

  // 清除搜索
  onClearSearch() {
    if (this.data.searchTimer) clearTimeout(this.data.searchTimer);
    this.setData({ searchText: '', searchKeyword: '' });
    this.loadItems();
  },

  // 跳转
  goAdd() {
    wx.navigateTo({ url: '/pages/add/add' });
  },
  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  },
});
