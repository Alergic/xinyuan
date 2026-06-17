// ============================================================
// 心愿计划 - 数据加载器
// 解决 Promise.all 单点故障和竞争条件问题
// ============================================================

/**
 * Loader — 依赖感知的异步任务调度器。
 *
 * 每个任务独立处理错误，一个失败不影响其他。
 * 支持声明任务间依赖关系，消除竞争条件。
 *
 * 用法：
 *   const loader = new Loader(this);
 *   loader
 *     .add('item', () => this.loadItem())
 *     .add('savings', () => this.loadSavings(), { dependsOn: ['item'] })
 *     .add('tasks', () => this.loadTasks());
 *   const { results, errors } = await loader.runAll();
 *   // results.item, results.savings, results.tasks
 *   // errors 包含失败任务的信息
 */
class Loader {
  constructor(pageInstance, options = {}) {
    this.page = pageInstance;
    this.tasks = [];
    this.results = {};
    this.errors = {};
    this.showLoading = options.showLoading !== false;
    this.loadingTitle = options.loadingTitle || '加载中...';
  }

  /**
   * 注册一个任务。
   * @param {string} name - 唯一任务名
   * @param {Function} fn - 异步执行函数
   * @param {object} opts
   * @param {string[]} opts.dependsOn - 依赖的任务名列表
   */
  add(name, fn, opts = {}) {
    this.tasks.push({ name, fn, dependsOn: opts.dependsOn || [] });
    return this;
  }

  /**
   * 执行所有任务。按依赖关系分层，层内并行，层间串行。
   * @returns {Promise<{results: object, errors: object}>}
   */
  async runAll() {
    if (this.showLoading) {
      wx.showLoading({ title: this.loadingTitle, mask: true });
    }

    const layers = this._buildLayers();

    for (const layer of layers) {
      // 层内任务并行执行
      const promises = layer.map(task => this._runSingle(task));
      await Promise.all(promises.map(p => p.catch(() => null)));
    }

    if (this.showLoading) {
      wx.hideLoading();
    }

    return { results: this.results, errors: this.errors };
  }

  async _runSingle(task) {
    try {
      const result = await task.fn();
      this.results[task.name] = result;
      return result;
    } catch (err) {
      console.error(`[Loader] "${task.name}" 失败:`, err);
      this.errors[task.name] = err;
      return null;
    }
  }

  _buildLayers() {
    const layers = [];
    const remaining = [...this.tasks];

    while (remaining.length > 0) {
      const layer = [];
      const deferred = [];

      for (const task of remaining) {
        // 检查所有依赖是否已在之前的层中
        const depsSatisfied = task.dependsOn.length === 0 ||
          task.dependsOn.every(depName =>
            layers.some(l => l.some(t => t.name === depName))
          );

        if (depsSatisfied) {
          layer.push(task);
        } else {
          deferred.push(task);
        }
      }

      if (layer.length === 0) {
        // 有依赖无法满足（循环依赖或缺少任务），将剩余任务独立执行
        console.warn('[Loader] 无法解析依赖，剩余任务将独立执行:', deferred.map(t => t.name));
        layers.push(deferred);
        break;
      }

      layers.push(layer);
      remaining.length = 0;
      remaining.push(...deferred);
    }

    return layers;
  }
}

/**
 * 安全并行：每个 promise 自己处理错误，永不失败。
 * 返回数组元素可能是 { _error: err } 标记。
 */
async function safeAll(promises) {
  return Promise.all(
    promises.map(p =>
      p.catch(err => {
        console.error('[safeAll] 任务失败:', err);
        return { _error: err };
      })
    )
  );
}

module.exports = { Loader, safeAll };
