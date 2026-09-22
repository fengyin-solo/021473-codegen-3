/**
 * 公告中心状态管理模块
 *
 * 功能说明：
 * - 维护公告列表（由 API 拉取后通过 syncAnnouncements 同步）
 * - 记录公告已读状态，按用户维度隔离（游客 / 登录用户ID）
 * - 已读状态持久化到 localStorage，返回首页或刷新后保持一致
 * - 已读记录以 "公告ID@修订版本" 为键，公告内容更新（revision 增加）后自动恢复未读
 * - 监听 authState 登录状态变化，自动切换已读状态命名空间
 *
 * 使用方式：
 * import { announcementStore, announcementState } from '@/utils/announcements'
 * announcementStore.syncScope()
 * await announcementStore.syncAnnouncements((await api.getAnnouncements()).data)
 * announcementStore.markAsRead('A001')
 */

import { reactive, watch } from 'vue'
import { authState } from './auth'

// ==================== 常量定义 ====================

/** localStorage 已读记录键名前缀（按作用域隔离） */
const STORAGE_PREFIX = 'billiard_announcements_read__'

/** 游客作用域 */
const GUEST_SCOPE = 'guest'

/**
 * 公告类别配置
 * @property {string} id - 类别ID（'all' 为全部筛选）
 * @property {string} name - 类别名称
 * @property {string} icon - 类别图标
 */
export const ANNOUNCEMENT_CATEGORIES = [
  { id: 'all', name: '全部', icon: '📋' },
  { id: 'notice', name: '重要通知', icon: '📢' },
  { id: 'activity', name: '活动消息', icon: '🎉' },
  { id: 'system', name: '系统更新', icon: '🛠️' }
]

// ==================== 响应式状态 ====================

/**
 * 公告中心响应式状态
 *
 * @property {string} scope - 当前已读状态作用域（'guest' 或 'u:<用户ID>'）
 * @property {Array} announcements - 当前公告列表
 * @property {Object} readMap - 已读映射表，键为 "公告ID@revision"，值为已读时间
 */
export const announcementState = reactive({
  scope: GUEST_SCOPE,
  announcements: [],
  readMap: {}
})

// ==================== 私有方法 ====================

/**
 * 根据登录状态计算当前作用域
 * @returns {string} 作用域标识
 * @private
 */
function resolveScope() {
  return authState.isLoggedIn && authState.user?.id
    ? `u:${authState.user.id}`
    : GUEST_SCOPE
}

/**
 * 从 localStorage 加载指定作用域的已读记录
 * @param {string} scope - 作用域标识
 * @returns {Object} 已读映射表
 * @private
 */
function loadReadMap(scope) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + scope)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (e) {
    // 数据损坏时按无已读记录处理
    return {}
  }
}

/**
 * 持久化当前作用域的已读记录
 * @private
 */
function persistReadMap() {
  try {
    localStorage.setItem(
      STORAGE_PREFIX + announcementState.scope,
      JSON.stringify(announcementState.readMap)
    )
  } catch (e) {
    // localStorage 不可用时仅保留内存态
  }
}

/**
 * 切换已读状态作用域（登录/退出时调用）
 * @param {string} scope - 新作用域标识
 * @private
 */
function setScope(scope) {
  if (announcementState.scope === scope) return
  announcementState.scope = scope
  announcementState.readMap = loadReadMap(scope)
}

/**
 * 生成公告的已读记录键（ID + 修订版本）
 * @param {Object} announcement - 公告对象
 * @returns {string} 已读记录键
 * @private
 */
function readKeyOf(announcement) {
  return `${announcement.id}@${announcement.revision || 1}`
}

// ==================== 公共方法 ====================

export const announcementStore = {
  /** 当前作用域 */
  get scope() {
    return announcementState.scope
  },

  /**
   * 获取全部公告
   * @returns {Array} 公告列表
   */
  getAll() {
    return announcementState.announcements
  },

  /**
   * 同步最新公告列表（内容更新入口）
   *
   * - 替换本地公告列表
   * - 清理已删除公告的已读记录
   * - 修订版本变化的公告因键不匹配自动恢复为未读
   *
   * @param {Array} list - 最新公告列表
   */
  syncAnnouncements(list) {
    const next = Array.isArray(list)
      ? list.map(a => ({ ...a, revision: a.revision || 1 }))
      : []

    // 仅保留仍存在且修订版本一致的已读记录
    const nextMap = {}
    for (const item of next) {
      const key = readKeyOf(item)
      if (key in announcementState.readMap) {
        nextMap[key] = announcementState.readMap[key]
      }
    }

    announcementState.announcements = next
    announcementState.readMap = nextMap
    persistReadMap()
  },

  /**
   * 判断公告是否已读
   *
   * 通过直接读取响应式属性建立依赖（hasOwnProperty 不会触发 Vue 的
   * get 拦截，无法驱动视图更新），值可能为 undefined 时以 "in" 兜底。
   *
   * @param {Object} announcement - 公告对象
   * @returns {boolean} 是否已读
   */
  isRead(announcement) {
    if (!announcement) return false
    const key = readKeyOf(announcement)
    return key in announcementState.readMap
  },

  /**
   * 获取未读公告数量
   * @param {Array} [list] - 可选，指定统计范围；默认统计全部公告
   * @returns {number} 未读数量
   */
  getUnreadCount(list) {
    const source = list || announcementState.announcements
    return source.reduce((count, item) => count + (this.isRead(item) ? 0 : 1), 0)
  },

  /**
   * 标记单条公告为已读（幂等）
   *
   * 重复点击同一条公告时返回 false，未读数量不会重复扣减。
   *
   * @param {string|number} id - 公告ID
   * @returns {boolean} 本次调用是否实际产生了状态变更
   */
  markAsRead(id) {
    const target = announcementState.announcements.find(
      item => String(item.id) === String(id)
    )
    if (!target) return false

    const key = readKeyOf(target)
    if (key in announcementState.readMap) {
      return false
    }

    announcementState.readMap[key] = new Date().toISOString()
    persistReadMap()
    return true
  },

  /**
   * 将全部公告标记为已读（幂等）
   * @returns {number} 本次实际标记的条数
   */
  markAllAsRead() {
    let changed = 0
    for (const item of announcementState.announcements) {
      if (this.markAsRead(item.id)) changed++
    }
    return changed
  },

  /**
   * 根据当前登录状态同步作用域
   * 应在应用启动及首页挂载时调用
   */
  syncScope() {
    setScope(resolveScope())
  },

  /**
   * 仅供单元测试：重置全部状态与持久化数据
   * @private
   */
  _resetForTesting() {
    try {
      const keysToRemove = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key && key.indexOf(STORAGE_PREFIX) === 0) keysToRemove.push(key)
      }
      keysToRemove.forEach(key => localStorage.removeItem(key))
    } catch (e) {
      // ignore
    }
    announcementState.scope = GUEST_SCOPE
    announcementState.announcements = []
    announcementState.readMap = {}
  }
}

// ==================== 登录状态联动 ====================

// 登录 / 退出登录后自动切换到对应作用域，未读数与阅读状态互不串用
watch(
  resolveScope,
  (newScope, oldScope) => {
    if (newScope !== oldScope) setScope(newScope)
  }
)

// 跨标签页同步已读状态
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === STORAGE_PREFIX + announcementState.scope && event.newValue) {
      try {
        announcementState.readMap = JSON.parse(event.newValue)
      } catch (e) {
        // 忽略无法解析的外部数据
      }
    }
  })
}

export default announcementStore
