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
    searchKeyword: '',
    statusLabel: '全部状态',
    categoryLabel: '全部分类',
    sortLabel: '最近更新',
  },

  onShow() {
    this.loadCategories();
    this.loadItems();
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

      // 已逾期是客户端计算状态，无法传给后端筛选
      const serverFilters = { ...filters };
      if (serverFilters.status === 'overdue') {
        serverFilters.status = 'all'; // 拉全量再客户端筛选
      }

      // 排序映射
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

      // 客户端轻量后处理：计算进度、展示状态、优先级文本
      const statusMap = app.globalData.statusMap;
      const priorityMap = app.globalData.priorityMap;
      for (let item of items) {
        // 计算存款进度
        item.progress = util.calcProgress(item.total_saved || 0, item.saving_target_amount);

        // 状态文本
        item.status_text = statusMap[item.status] || item.status;

        // 优先级文本
        item.priority_text = priorityMap[item.priority] || '';

        // Deadline 处理 + display_status 计算
        if (item.deadline) {
          item.days_left = util.getDaysRemaining(item.deadline);
          item.deadline_text = util.formatDate(item.deadline);
        }

        // display_status 计算规则：
        // purchased/abandoned/paused — 终态，原样展示
        // planning — 初始状态，与其他非终态一样自动推导
        if (item.status === 'purchased' || item.status === 'abandoned' || item.status === 'paused') {
          item.display_status = item.status;
        } else {
          // 自动判断：overdue > buyable > saving > planning
          if (item.deadline && item.days_left < 0) {
            item.display_status = 'overdue';
          } else if (
            (item.target_price && item.current_price <= item.target_price) ||
            (item.progress >= item.target_save_percent)
          ) {
            item.display_status = 'buyable';
          } else if ((item.total_saved || 0) > 0) {
            item.display_status = 'saving';
          } else {
            item.display_status = 'planning';
          }
        }

        // display_status 文本
        item.status_text = statusMap[item.display_status] || item.status_text;
      }

      // 客户端筛选：已逾期（后端不认识此状态）
      if (filters.status === 'overdue') {
        items = items.filter(i => i.display_status === 'overdue');
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

  // 搜索
  onSearch() {
    wx.showModal({
      title: '搜索心愿',
      editable: true,
      placeholderText: '输入物品名称',
      success: (res) => {
        if (res.confirm && res.content) {
          this.setData({ searchKeyword: res.content });
          this.loadItems();
        }
      },
    });
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
