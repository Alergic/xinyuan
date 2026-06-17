// 存款标签管理
const util = require('../../utils/util.js');

Page({
  data: {
    tags: [],
  },

  onShow() {
    this.loadTags();
  },

  async loadTags() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'saving',
        data: { action: 'listTags' },
      });
      if (res.result.code === 0) {
        this.setData({ tags: res.result.data.tags });
      }
    } catch (err) {
      console.error('加载标签失败:', err);
    }
  },

  // 添加标签
  addTag() {
    wx.showModal({
      title: '新建标签',
      editable: true,
      placeholderText: '输入标签名（最多10字）',
      success: async (res) => {
        if (!res.confirm || !res.content) return;
        const name = res.content.trim();
        if (!name) return;
        if (name.length > 10) {
          util.showToast('标签名最多10个字');
          return;
        }
        try {
          const result = await wx.cloud.callFunction({
            name: 'saving',
            data: { action: 'createTag', data: { name } },
          });
          if (result.result.code === 0) {
            util.showToast('已创建', 'success');
            this.loadTags();
          } else {
            util.showToast(result.result.msg || '创建失败');
          }
        } catch (err) {
          util.showToast('创建失败');
        }
      },
    });
  },

  // 编辑标签
  editTag(e) {
    const tag = e.currentTarget.dataset.tag;
    wx.showActionSheet({
      itemList: ['修改名称', '修改颜色'],
      success: async (res) => {
        switch (res.tapIndex) {
          case 0: this.renameTag(tag); break;
          case 1: this.recolorTag(tag); break;
        }
      },
    });
  },

  renameTag(tag) {
    wx.showModal({
      title: '修改名称',
      editable: true,
      placeholderText: '新名称',
      content: tag.name,
      success: async (res) => {
        if (!res.confirm || !res.content) return;
        const name = res.content.trim();
        if (!name || name === tag.name) return;
        if (name.length > 10) {
          util.showToast('标签名最多10个字');
          return;
        }
        try {
          const result = await wx.cloud.callFunction({
            name: 'saving',
            data: { action: 'updateTag', data: { id: tag._id, name } },
          });
          if (result.result.code === 0) {
            util.showToast('已更新', 'success');
            this.loadTags();
          } else {
            util.showToast(result.result.msg || '更新失败');
          }
        } catch (err) {
          util.showToast('更新失败');
        }
      },
    });
  },

  recolorTag(tag) {
    // wx.showActionSheet 最多支持 6 项，精选 6 个区分度高的颜色
    const colors = ['#FF6B6B', '#FFA726', '#66BB6A', '#42A5F5', '#AB47BC', '#78909C'];
    const itemList = ['🔴 红', '🟠 橙', '🟢 绿', '🔵 蓝', '🟣 紫', '⚫ 灰'];
    wx.showActionSheet({
      itemList,
      success: async (res) => {
        const color = colors[res.tapIndex];
        try {
          const result = await wx.cloud.callFunction({
            name: 'saving',
            data: { action: 'updateTag', data: { id: tag._id, color } },
          });
          if (result.result.code === 0) {
            util.showToast('颜色已更新', 'success');
            this.loadTags();
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

  // 🗑 按钮点击入口（从 event 提取 tag）
  onDeleteTag(e) {
    this.confirmDelete(e.currentTarget.dataset.tag);
  },

  confirmDelete(tag) {
    wx.showModal({
      title: '删除标签',
      content: `确定删除「${tag.name}」？所有存款记录中的该标签也会被移除。`,
      confirmColor: '#EF5350',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          const result = await wx.cloud.callFunction({
            name: 'saving',
            data: { action: 'deleteTag', data: { id: tag._id } },
          });
          if (result.result.code === 0) {
            util.showToast('已删除', 'success');
            this.loadTags();
          } else {
            util.showToast(result.result.msg || '删除失败');
          }
        } catch (err) {
          util.showToast('删除失败');
        }
      },
    });
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
    if (index >= this.data.tags.length - 1) return;
    this.swapSort(index, index + 1);
  },

  // 排序：交换两个标签的位置
  async swapSort(fromIdx, toIdx) {
    const list = [...this.data.tags];
    const a = list[fromIdx];
    const b = list[toIdx];
    const aSort = a.sort_order != null ? a.sort_order : fromIdx;
    const bSort = b.sort_order != null ? b.sort_order : toIdx;

    try {
      await Promise.all([
        wx.cloud.callFunction({ name: 'saving', data: { action: 'updateTag', data: { id: a._id, sort_order: bSort } } }),
        wx.cloud.callFunction({ name: 'saving', data: { action: 'updateTag', data: { id: b._id, sort_order: aSort } } }),
      ]);
      a.sort_order = bSort;
      b.sort_order = aSort;
      [list[fromIdx], list[toIdx]] = [list[toIdx], list[fromIdx]];
      this.setData({ tags: list });
    } catch (err) {
      util.showToast('排序失败');
    }
  },
});
