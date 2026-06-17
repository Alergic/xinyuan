// 云函数：用户登录 + 资料管理
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;

    // 登录获取 openid（默认行为，兼容旧调用）
    if (!event.action || event.action === 'login') {
      return {
        openid,
        appid: wxContext.APPID,
        unionid: wxContext.UNIONID || '',
      };
    }

    // 获取用户资料
    if (event.action === 'getProfile') {
      const res = await db.collection('user_profile')
        .where({ user_id: openid })
        .get();
      return { code: 0, data: { profile: res.data[0] || null } };
    }

    // 保存用户资料（upsert）
    if (event.action === 'saveProfile') {
      const { avatarUrl, nickname, signature } = event.data || {};
      const existing = await db.collection('user_profile')
        .where({ user_id: openid })
        .get();

      const profileData = {
        user_id: openid,
        avatarUrl: avatarUrl || '',
        nickname: nickname || '',
        signature: signature || '',
        updated_at: new Date(),
      };

      if (existing.data.length > 0) {
        await db.collection('user_profile').doc(existing.data[0]._id).update({
          data: profileData,
        });
      } else {
        profileData.created_at = new Date();
        await db.collection('user_profile').add({ data: profileData });
      }

      return { code: 0, msg: '保存成功' };
    }

    return { code: -1, msg: '未知操作' };
  } catch (err) {
    console.error('login 云函数异常:', err);
    return { code: -1, msg: err.message || '登录失败' };
  }
};
