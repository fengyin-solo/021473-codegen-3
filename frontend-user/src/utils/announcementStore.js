/**
 * 公告中心存储管理
 *
 * 功能说明：
 * - 拉取公告数据（重要通知 / 活动消息），支持按类别筛选与搜索
 * - 管理每个账号独立的已读状态，使用 localStorage 持久化
 * - 公告内容更新（updatedAt 变化）后自动恢复为未读
 * - 登录状态变化时切换到对应账号的已读记录
 * - 重复标记已读为幂等操作，不会产生重复计数
 */

import { reactive, computed, watch } from 'vue'
import { authState } from './auth'
import { api, logger } from './api'

// ==================== 常量定义 ====================

/** localStorage中存储已读状态的键名前缀（按用户隔离） */
const READ_STORAGE_PREFIX = 'billiard_announcement_read_'

/** 未登录访客使用的键名 */
const GUEST_KEY = 'guest'

/** 公告类别配置 */
export const announcementCategories = {
  notice: { name: '重要通知', icon: '📢', color: '#ff6b6b' },
  activity: { name: '活动消息', icon: '🎉', color: 'var(--primary)' }
}

// ==================== 响应式状态 ====================

/**
 * 公告状态对象（响应式）
 *
 * @property {Array} announcements - 公告原始列表
 * @property {Object} readMap - 已读记录 { [公告ID]: 已读时的updatedAt }
 * @property {boolean} loading - 是否正在加载
 * @property {boolean} initialized - 是否已完成首次加载
 * @property {string|null} error - 最近一次错误信息
 * @property {string|null} currentUserId - 当前已读记录所属用户
 */
export const announcementState = reactive({
  announcements: [],
  readMap: {},
  loading: false,
  initialized: false,
  error: null,
  currentUserId: null
})

// ==================== 计算属性 ====================

/** 当前账号下的未读公告数量 */
export const unreadCount = computed(() => getUnreadList(announcementState.announcements).length)

// ==================== 私有方法 ====================

/**
 * 获取当前已读记录对应的存储标识
 * @returns {string} 用户ID或访客标识
 */
function getReadStorageKey() {
  return READ_STORAGE_PREFIX + (authState.user?.id || GUEST_KEY)
}

/**
 * 规范化公告数据，补齐默认字段
 * @param {Object} item - 原始公告
 * @returns {Object} 规范化后的公告
 */
function normalizeAnnouncement(item) {
  const normalized = {
    title: '',
    content: '',
    category: 'notice',
    important: false,
    pinned: false,
    createdAt: '',
    updatedAt: '',
    ...item,
    id: String(item.id)
  }
  if (!announcementCategories[normalized.category]) {
    normalized.category = 'notice'
  }
  if (!normalized.updatedAt) {
    normalized.updatedAt = normalized.createdAt
  }
  return normalized
}

/**
 * 合并已读状态，返回带阅读信息的公告
 * @param {Object} announcement - 公告对象
 * @returns {Object} 附带 read/categoryName/categoryIcon 字段的公告
 */
function withReadState(announcement) {
  const categoryInfo = announcementCategories[announcement.category] || announcementCategories.notice
  const readVersion = announcementState.readMap[announcement.id]
  // 已读记录的内容版本与当前一致才算已读；内容更新后自动变为未读
  const isRead = readVersion !== undefined && readVersion === announcement.updatedAt
  return {
    ...announcement,
    read: isRead,
    categoryName: categoryInfo.name,
    categoryIcon: categoryInfo.icon
  }
}

/**
 * 从列表中筛选未读公告
 * @param {Array} list - 公告列表
 * @returns {Array} 未读公告列表
 */
function getUnreadList(list) {
  return list.filter(item => !withReadState(item).read)
}

/**
 * 从 localStorage 恢复当前账号的已读记录
 */
function loadReadState() {
  const userId = authState.user?.id || null
  announcementState.currentUserId = userId

  let stored = {}
  try {
    const raw = localStorage.getItem(getReadStorageKey())
    stored = raw ? JSON.parse(raw) : {}
  } catch (e) {
    logger.error('公告已读记录解析失败', e)
    stored = {}
  }
  announcementState.readMap = stored && typeof stored === 'object' ? stored : {}
  logger.info('公告已读记录已加载', { userId, count: Object.keys(announcementState.readMap).length })
}

/**
 * 持久化当前账号的已读记录
 */
function saveReadState() {
  try {
    localStorage.setItem(getReadStorageKey(), JSON.stringify(announcementState.readMap))
  } catch (e) {
    logger.error('公告已读记录保存失败', e)
  }
}

// ==================== 公共方法 ====================

/**
 * 拉取最新公告
 *
 * - 内容版本（updatedAt）变化的公告会重新变为未读
 * - 请求失败时保留已有数据，不清空页面
 * - 重复并发调用会被合并，避免重复点击造成多余请求
 *
 * @param {Object} [options]
 * @param {boolean} [options.force=false] - 是否强制刷新（忽略进行中的请求）
 * @returns {Promise<Array>} 带阅读状态的公告列表
 */
export async function refreshAnnouncements(options = {}) {
  if (announcementState.loading && !options.force) {
    logger.info('公告加载进行中，跳过重复请求')
    return getAllAnnouncements()
  }

  announcementState.loading = true
  announcementState.error = null

  try {
    const result = await api.getAnnouncements()
    if (!result.success) {
      throw new Error(result.error || '公告加载失败')
    }

    const list = Array.isArray(result.data) ? result.data.map(normalizeAnnouncement) : []

    // 内容更新（updatedAt 变化）的公告：旧的已读记录不再匹配，自动恢复未读
    announcementState.announcements = list
    announcementState.initialized = true
    logger.info('公告列表已更新', { count: list.length })
    return getAllAnnouncements()
  } catch (error) {
    announcementState.error = error.message
    logger.error('公告加载失败', error)
    return getAllAnnouncements()
  } finally {
    announcementState.loading = false
  }
}

/**
 * 获取全部公告（带已读状态），置顶与重要公告优先，其余按时间倒序
 * @returns {Array} 公告列表
 */
export function getAllAnnouncements() {
  return announcementState.announcements
    .map(withReadState)
    .sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
      if (!!a.important !== !!b.important) return a.important ? -1 : 1
      return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
    })
}

/**
 * 标记单条公告为已读（幂等，重复点击不会重复计数）
 * @param {string} announcementId - 公告ID
 * @returns {boolean} 本次调用是否产生了状态变化
 */
export function markAsRead(announcementId) {
  const id = String(announcementId)
  const announcement = announcementState.announcements.find(item => item.id === id)
  if (!announcement) {
    logger.warn('公告不存在，无法标记已读', id)
    return false
  }

  // 已读且内容版本一致时直接返回，保证重复点击无副作用
  if (announcementState.readMap[id] === announcement.updatedAt) {
    return false
  }

  announcementState.readMap[id] = announcement.updatedAt
  saveReadState()
  logger.info('公告已标记为已读', { id })
  return true
}

/**
 * 将未读公告全部标记为已读
 * @param {Array} [list] - 可选，仅标记该列表范围内的公告；默认标记全部
 * @returns {number} 本次新标记的数量（已为已读的不重复计数）
 */
export function markAllAsRead(list) {
  const scope = list || announcementState.announcements
  let changed = 0

  scope.forEach(item => {
    const id = String(item.id)
    const announcement = announcementState.announcements.find(a => a.id === id)
    if (announcement && announcementState.readMap[id] !== announcement.updatedAt) {
      announcementState.readMap[id] = announcement.updatedAt
      changed++
    }
  })

  if (changed > 0) {
    saveReadState()
    logger.info('公告批量已读', { changed })
  }
  return changed
}

/**
 * 获取某类别下的未读数量
 * @param {string} category - 类别标识，传 'all' 返回全部未读数
 * @returns {number} 未读数量
 */
export function getUnreadCount(category = 'all') {
  const list = getAllAnnouncements()
  const scoped = category === 'all' ? list : list.filter(item => item.category === category)
  return scoped.filter(item => !item.read).length
}

// ==================== 登录状态联动 ====================

// 登录 / 退出登录时切换到对应账号的已读记录（不同账号互不影响）
watch(
  () => authState.user?.id || null,
  () => {
    if (announcementState.currentUserId !== (authState.user?.id || null)) {
      loadReadState()
    }
  }
)

// 多标签页同步：其他页面更新已读状态后同步当前页
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key && event.key.startsWith(READ_STORAGE_PREFIX)) {
      const ownKey = getReadStorageKey()
      if (event.key === ownKey) {
        try {
          announcementState.readMap = event.newValue ? JSON.parse(event.newValue) : {}
        } catch (e) {
          logger.error('同步公告已读记录失败', e)
        }
      } else if (event.key === READ_STORAGE_PREFIX + GUEST_KEY && !authState.user) {
        loadReadState()
      }
    }
  })
}

// 初始化当前账号的已读记录
loadReadState()

export default {
  announcementState,
  announcementCategories,
  unreadCount,
  refreshAnnouncements,
  getAllAnnouncements,
  markAsRead,
  markAllAsRead,
  getUnreadCount
}
