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

  // 编辑分类
  editCategory(e) {
    const item = e.currentTarget.dataset.item;
    wx.showModal({
      title: '编辑分类名称',
      editable: true,
      placeholderText: '输入新名称',
      content: item.name,
      success: async (res) => {
        if (res.confirm && res.content.trim()) {
          const name = res.content.trim();
          try {
            await wx.cloud.callFunction({
              name: 'category',
              data: { action: 'update', data: { id: item._id, name } },
            });
            util.showToast('已保存', 'success');
            this.loadCategories();
          } catch (err) {
            console.error('编辑分类失败:', err);
            util.showToast('保存失败，请重试');
          }
        }
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
