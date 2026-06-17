// 添加/编辑心愿页逻辑
const util = require('../../utils/util.js');

Page({
  data: {
    isEdit: false,
    editId: null,
    categories: [],
    categoryNames: ['未分类'],
    imageUrls: [],
    form: {
      name: '',
      current_price: '',
      target_price: '',
      category_id: '',
      category_index: 0,
      priority: 'medium',
      deadline: '',
      deadline_text: '',
      image_url: '',
      product_url: '',
      description: '',
      target_save_percent: 100,
    },
  },

  onLoad(options) {
    // 如果是编辑模式，传入 id
    if (options.id) {
      this.setData({ isEdit: true, editId: options.id });
      wx.setNavigationBarTitle({ title: '编辑心愿' });
      this.loadItem(options.id);
    }
    this.loadCategories();
  },

  // 加载分类
  async loadCategories() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'category',
        data: { action: 'list' },
      });
      const categories = res.result.data || [];
      this.setData({
        categories,
        categoryNames: ['未分类', ...categories.map(c => c.name)],
      });
    } catch (err) {
      console.error('加载分类失败:', err);
    }
  },

  // 加载编辑物品
  async loadItem(id) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'wishlist',
        data: { action: 'get', data: { id } },
      });
      if (res.result.code === 0) {
        const item = res.result.data;
        const catIndex = this.data.categories.findIndex(c => c._id === item.category_id) + 1;

        // 多图：优先用 image_urls，回退到单张 image_url
        let imageUrls = [];
        if (item.image_urls && item.image_urls.length > 0) {
          imageUrls = item.image_urls;
        } else if (item.image_url) {
          imageUrls = [item.image_url];
        }

        this.setData({
          imageUrls,
          form: {
            name: item.name || '',
            current_price: String(item.current_price || ''),
            target_price: item.target_price ? String(item.target_price) : '',
            category_id: item.category_id || '',
            category_index: Math.max(catIndex, 0),
            priority: item.priority || 'medium',
            deadline: item.deadline ? util.formatDate(item.deadline) : '',
            deadline_text: item.deadline ? util.formatDate(item.deadline) : '',
            image_url: item.image_url || '',
            product_url: item.product_url || '',
            description: item.description || '',
            target_save_percent: item.target_save_percent || 100,
          },
        });
      }
    } catch (err) {
      console.error('加载物品失败:', err);
    }
  },

  // 字段变化
  onFieldChange(e) {
    const { field } = e.currentTarget.dataset;
    this.setData({ [`form.${field}`]: e.detail.value });
  },

  // 分类选择
  onCategoryChange(e) {
    const index = parseInt(e.detail.value);
    const category_id = index === 0 ? '' : (this.data.categories[index - 1]?._id || '');
    this.setData({
      'form.category_index': index,
      'form.category_id': category_id,
    });
  },

  // 目标存款比例
  onPercentChange(e) {
    this.setData({ 'form.target_save_percent': e.detail.value });
  },

  // 优先级选择
  setPriority(e) {
    this.setData({ 'form.priority': e.currentTarget.dataset.value });
  },

  // Deadline 选择
  onDeadlineChange(e) {
    this.setData({
      'form.deadline': e.detail.value,
      'form.deadline_text': e.detail.value,
    });
  },

  // 清除 Deadline
  clearDeadline() {
    this.setData({
      'form.deadline': '',
      'form.deadline_text': '',
    });
  },

  // 上传图片（追加到列表，最多 3 张）
  uploadImage() {
    const remaining = 3 - this.data.imageUrls.length;
    if (remaining <= 0) return util.showToast('最多上传 3 张图片');

    wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: async (res) => {
        wx.showLoading({ title: '上传中...' });
        try {
          const uploaded = [];
          for (const file of res.tempFiles) {
            const cloudRes = await wx.cloud.uploadFile({
              cloudPath: `images/${Date.now()}_${Math.random().toString(36).substring(2, 8)}.jpg`,
              filePath: file.tempFilePath,
            });
            uploaded.push(cloudRes.fileID);
          }
          const imageUrls = [...this.data.imageUrls, ...uploaded];
          this.setData({ imageUrls });
          wx.hideLoading();
          util.showToast(`已上传 ${uploaded.length} 张`, 'success');
        } catch (err) {
          wx.hideLoading();
          util.showToast('上传失败');
        }
      },
    });
  },

  // 移除图片
  removeImage(e) {
    const { index } = e.currentTarget.dataset;
    const imageUrls = [...this.data.imageUrls];
    imageUrls.splice(index, 1);
    this.setData({ imageUrls });
  },

  // 提交表单
  async submit() {
    const { form } = this.data;

    // 校验必填项
    if (!form.name.trim()) {
      return util.showToast('请输入物品名称');
    }
    if (!form.current_price || parseFloat(form.current_price) <= 0) {
      return util.showToast('请输入有效的当前价格');
    }

    wx.showLoading({ title: this.data.isEdit ? '保存中...' : '添加中...' });

    try {
      // 存款目标金额：目标价格 > 当前价格
      const targetPrice = form.target_price ? parseFloat(form.target_price) : null;
      const currentPrice = parseFloat(form.current_price);
      const savingTarget = targetPrice || currentPrice;

      const payload = {
        name: form.name.trim(),
        current_price: currentPrice,
        target_price: targetPrice,
        saving_target_amount: savingTarget,
        target_save_percent: form.target_save_percent,
        priority: form.priority,
        category_id: form.category_id || 'default',
        description: form.description,
        product_url: form.product_url,
        image_urls: this.data.imageUrls,
        deadline: form.deadline ? `${form.deadline}T23:59:59` : null,
      };

      if (this.data.isEdit) {
        // 编辑模式
        await wx.cloud.callFunction({
          name: 'wishlist',
          data: { action: 'update', data: { id: this.data.editId, ...payload } },
        });
      } else {
        // 新增模式
        await wx.cloud.callFunction({
          name: 'wishlist',
          data: { action: 'add', data: payload },
        });
      }

      wx.hideLoading();
      util.showToast(this.data.isEdit ? '保存成功' : '添加成功', 'success');

      setTimeout(() => wx.navigateBack(), 1500);
    } catch (err) {
      wx.hideLoading();
      console.error('提交失败:', err);
      util.showToast('操作失败，请重试');
    }
  },

  // 删除物品
  async deleteItem() {
    const confirmed = await util.showConfirm('确定要删除这个心愿吗？此操作不可恢复。');
    if (!confirmed) return;

    try {
      await wx.cloud.callFunction({
        name: 'wishlist',
        data: { action: 'delete', data: { id: this.data.editId } },
      });
      util.showToast('已删除', 'success');
      setTimeout(() => {
        wx.navigateBack({ delta: 2 }); // 返回到列表页
      }, 1500);
    } catch (err) {
      util.showToast('删除失败');
    }
  },
});
