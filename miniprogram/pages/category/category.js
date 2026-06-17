// 分类管理页逻辑
const util = require('../../utils/util.js');

Page({
  data: {
    categories: [],
  },

  onShow() {
    this.loadCategories();
  },

  async loadCategories() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'category',
        data: { action: 'list' },
      });
      this.setData({ categories: res.result.data || [] });
    } catch (err) {
      console.error('加载分类失败:', err);
      util.showToast('加载分类失败');
    }
  },

  // 添加分类
  addCategory() {
    wx.showModal({
      title: '添加分类',
      editable: true,
      placeholderText: '输入分类名称',
      success: async (res) => {
        if (res.confirm && res.content.trim()) {
          const name = res.content.trim();
          const colors = ['#4A90D9', '#E85D75', '#F5A623', '#7ED321', '#50C1E9', '#5C6BC0', '#EC407A', '#26A69A'];
          const color = colors[Math.floor(Math.random() * colors.length)];

          try {
            await wx.cloud.callFunction({
              name: 'category',
              data: { action: 'add', data: { name, color } },
            });
            util.showToast('分类已添加', 'success');
            this.loadCategories();
          } catch (err) {
            console.error('添加分类失败:', err);
            util.showToast('添加失败，请重试');
          }
        }
      },
    });
  },

  // 编辑分类（ActionSheet：修改名称 / 修改颜色）
  editCategory(e) {
    const item = e.currentTarget.dataset.item;
    wx.showActionSheet({
      itemList: ['修改名称', '修改颜色'],
      success: async (res) => {
        switch (res.tapIndex) {
          case 0: this.renameCategory(item); break;
          case 1: this.recolorCategory(item); break;
        }
      },
    });
  },

  // 修改分类名称
  renameCategory(item) {
    wx.showModal({
      title: '修改分类名称',
      editable: true,
      placeholderText: '输入新名称',
      content: item.name,
      success: async (res) => {
        if (res.confirm && res.content.trim()) {
          const name = res.content.trim();
          if (name === item.name) return;
          try {
            const result = await wx.cloud.callFunction({
              name: 'category',
              data: { action: 'update', data: { id: item._id, name } },
            });
            if (result.result.code === 0) {
              util.showToast('已保存', 'success');
              this.loadCategories();
            } else {
              util.showToast(result.result.msg || '保存失败');
            }
          } catch (err) {
            console.error('编辑分类失败:', err);
            util.showToast('保存失败，请重试');
          }
        }
      },
    });
  },

  // 修改分类颜色
  recolorCategory(item) {
    // wx.showActionSheet 最多支持 6 项，精选 6 个区分度高的颜色
    const colors = ['#FF6B6B', '#FFA726', '#66BB6A', '#42A5F5', '#AB47BC', '#78909C'];
    const itemList = ['🔴 红', '🟠 橙', '🟢 绿', '🔵 蓝', '🟣 紫', '⚫ 灰'];
    wx.showActionSheet({
      itemList,
      success: async (res) => {
        const color = colors[res.tapIndex];
        try {
          const result = await wx.cloud.callFunction({
            name: 'category',
            data: { action: 'update', data: { id: item._id, color } },
          });
          if (result.result.code === 0) {
            util.showToast('颜色已更新', 'success');
            this.loadCategories();
          } else {
            util.showToast(result.result.msg || '更新失败');
          }
        } catch (err) {
          util.showToast('更新失败');
        }
      },
      fail: () => {
        util.showToast('选择失败');
      },
    });
  },

  // 点击分类 → 查看该分类下的心愿列表
  goWishlistByCategory(e) {
    const { id, name } = e.currentTarget.dataset;
    const app = getApp();
    app.globalData.pendingCategoryFilter = {
      category_id: id,
      category_name: name,
    };
    wx.switchTab({ url: '/pages/wishlist/wishlist' });
  },

  // 排序：上移
  moveUp(e) {
    const index = e.currentTarget.dataset.index;
    if (index === 0) return;
    this.swapSort(index, index - 1);
  },

  // 排序：下移
  moveDown(e) {
    const index = e.currentTarget.dataset.index;
    if (index >= this.data.categories.length - 1) return;
    this.swapSort(index, index + 1);
  },

  // 排序：交换两个分类的位置
  async swapSort(fromIdx, toIdx) {
    const list = [...this.data.categories];
    const a = list[fromIdx];
    const b = list[toIdx];
    const aSort = a.sort_order != null ? a.sort_order : fromIdx;
    const bSort = b.sort_order != null ? b.sort_order : toIdx;

    try {
      await Promise.all([
        wx.cloud.callFunction({ name: 'category', data: { action: 'update', data: { id: a._id, sort_order: bSort } } }),
        wx.cloud.callFunction({ name: 'category', data: { action: 'update', data: { id: b._id, sort_order: aSort } } }),
      ]);
      // 更新本地数据
      a.sort_order = bSort;
      b.sort_order = aSort;
      [list[fromIdx], list[toIdx]] = [list[toIdx], list[fromIdx]];
      this.setData({ categories: list });
    } catch (err) {
      util.showToast('排序失败');
    }
  },

  // 删除分类
  async deleteCategory(e) {
    const id = e.currentTarget.dataset.id;
    const confirmed = await util.showConfirm('删除后，该分类下的物品将变为"未分类"');
    if (!confirmed) return;
    try {
      await wx.cloud.callFunction({
        name: 'category',
        data: { action: 'delete', data: { id } },
      });
      util.showToast('已删除');
      this.loadCategories();
    } catch (err) {
      console.error('删除分类失败:', err);
      util.showToast('删除失败，请重试');
    }
  },
});
