/**
 * 公告中心存储模块单元测试
 *
 * 测试范围：
 * - 公告加载与空数据
 * - 已读 / 未读状态与未读数量
 * - 重复点击标记已读（幂等）
 * - 一键全部已读（仅统计新标记数量）
 * - 内容更新后已读自动失效
 * - 登录状态变化后已读记录按账号切换
 * - 已读状态 localStorage 持久化
 * - 并发刷新请求合并
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'

vi.mock('../utils/api', () => ({
  api: {
    getAnnouncements: vi.fn()
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

import { api } from '../utils/api'
import { authState } from '../utils/auth'
import {
  announcementState,
  refreshAnnouncements,
  getAllAnnouncements,
  markAsRead,
  markAllAsRead,
  getUnreadCount
} from '../utils/announcementStore'

// ==================== 测试数据 ====================

const buildAnnouncements = () => [
  {
    id: 1,
    title: '营业时间调整通知',
    content: '国庆期间营业时间调整',
    category: 'notice',
    important: true,
    pinned: true,
    createdAt: '2026-09-20 10:00',
    updatedAt: '2026-09-20 10:00'
  },
  {
    id: 2,
    title: '秋季双打赛报名',
    content: '会员报名享八折',
    category: 'activity',
    important: false,
    pinned: false,
    createdAt: '2026-09-18 14:30',
    updatedAt: '2026-09-18 14:30'
  },
  {
    id: 3,
    title: '系统维护公告',
    content: '凌晨系统升级',
    category: 'notice',
    important: false,
    pinned: false,
    createdAt: '2026-09-15 09:00',
    updatedAt: '2026-09-15 09:00'
  }
]

const mockSuccess = (data) => {
  api.getAnnouncements.mockResolvedValue({ success: true, data })
}

// 每个用例使用独立用户ID，避免单例 readMap 互相干扰
let userSeq = 0
const switchUser = async () => {
  userSeq += 1
  authState.isLoggedIn = true
  authState.user = { id: 'U_TEST_' + userSeq, name: '测试用户' + userSeq }
  await nextTick()
}

// ==================== 测试用例 ====================

describe('Announcement Store', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    localStorage.clear()
    authState.isLoggedIn = false
    authState.user = null
    await nextTick()
    announcementState.announcements = []
    announcementState.readMap = {}
    announcementState.initialized = false
    announcementState.error = null
    announcementState.loading = false
    announcementState.currentUserId = null
  })

  describe('refreshAnnouncements', () => {
    it('初始状态未读数为 0', () => {
      expect(getUnreadCount()).toBe(0)
    })

    it('应成功加载公告且全部为未读', async () => {
      mockSuccess(buildAnnouncements())

      const list = await refreshAnnouncements()

      expect(list).toHaveLength(3)
      expect(getUnreadCount()).toBe(3)
      expect(getUnreadCount('notice')).toBe(2)
      expect(getUnreadCount('activity')).toBe(1)
      expect(list.every(item => item.read === false)).toBe(true)
    })

    it('空公告列表时未读数为 0 且不报错', async () => {
      mockSuccess([])

      const list = await refreshAnnouncements()

      expect(list).toHaveLength(0)
      expect(getUnreadCount()).toBe(0)
      expect(announcementState.error).toBeNull()
    })

    it('接口失败时保留已有公告并记录错误', async () => {
      mockSuccess(buildAnnouncements())
      await refreshAnnouncements()

      api.getAnnouncements.mockResolvedValue({ success: false, error: '网络错误' })
      const list = await refreshAnnouncements()

      expect(list).toHaveLength(3)
      expect(announcementState.error).toBe('网络错误')
    })

    it('置顶和重要公告排在前面，其余按更新时间倒序', async () => {
      mockSuccess([
        { id: 10, category: 'activity', title: '普通活动', pinned: false, important: false, createdAt: '2026-09-19 10:00', updatedAt: '2026-09-19 10:00' },
        { id: 11, category: 'notice', title: '置顶通知', pinned: true, important: false, createdAt: '2026-09-01 10:00', updatedAt: '2026-09-01 10:00' },
        { id: 12, category: 'notice', title: '重要通知', pinned: false, important: true, createdAt: '2026-09-10 10:00', updatedAt: '2026-09-10 10:00' }
      ])

      const list = await refreshAnnouncements()

      expect(list.map(i => i.id)).toEqual(['11', '12', '10'])
    })

    it('重复并发调用合并为一次请求', async () => {
      mockSuccess(buildAnnouncements())

      await Promise.all([
        refreshAnnouncements(),
        refreshAnnouncements(),
        refreshAnnouncements()
      ])

      expect(api.getAnnouncements).toHaveBeenCalledTimes(1)
    })
  })

  describe('markAsRead', () => {
    it('标记已读后未读数相应减少并持久化', async () => {
      mockSuccess(buildAnnouncements())
      await refreshAnnouncements()

      const changed = markAsRead(1)

      expect(changed).toBe(true)
      expect(getUnreadCount()).toBe(2)
      const stored = JSON.parse(localStorage.getItem('billiard_announcement_read_guest'))
      expect(stored['1']).toBe('2026-09-20 10:00')

      const item = getAllAnnouncements().find(a => a.id === '1')
      expect(item.read).toBe(true)
    })

    it('重复点击同一条公告为幂等操作，未读数不再变化', async () => {
      mockSuccess(buildAnnouncements())
      await refreshAnnouncements()

      expect(markAsRead(2)).toBe(true)
      expect(getUnreadCount()).toBe(2)
      expect(markAsRead(2)).toBe(false)
      expect(getUnreadCount()).toBe(2)

      const stored = JSON.parse(localStorage.getItem('billiard_announcement_read_guest'))
      expect(Object.keys(stored)).toEqual(['2'])
    })
  })

  describe('markAllAsRead', () => {
    it('一键全部已读后未读数清零，再次调用不重复计数', async () => {
      mockSuccess(buildAnnouncements())
      await refreshAnnouncements()

      expect(markAllAsRead()).toBe(3)
      expect(getUnreadCount()).toBe(0)
      expect(markAllAsRead()).toBe(0)
    })

    it('仅标记指定范围内的公告', async () => {
      mockSuccess(buildAnnouncements())
      await refreshAnnouncements()

      const activities = getAllAnnouncements().filter(i => i.category === 'activity')
      const changed = markAllAsRead(activities)

      expect(changed).toBe(1)
      expect(getUnreadCount('activity')).toBe(0)
      expect(getUnreadCount('notice')).toBe(2)
    })
  })

  describe('内容更新', () => {
    it('公告 updatedAt 变化后已读状态自动失效，恢复未读', async () => {
      const data = buildAnnouncements()
      mockSuccess(data)
      await refreshAnnouncements()
      markAsRead(3)
      expect(getUnreadCount()).toBe(2)

      // 模拟服务端内容更新
      data[2] = { ...data[2], content: '维护时间变更', updatedAt: '2026-09-21 08:00' }
      mockSuccess(data)
      await refreshAnnouncements()

      expect(getUnreadCount()).toBe(3)
      const item = getAllAnnouncements().find(a => a.id === '3')
      expect(item.read).toBe(false)
    })

    it('未更新的公告已读状态保持不变', async () => {
      const data = buildAnnouncements()
      mockSuccess(data)
      await refreshAnnouncements()
      markAsRead(1)

      mockSuccess([...data])
      await refreshAnnouncements()

      expect(getUnreadCount()).toBe(2)
    })
  })

  describe('登录状态变化', () => {
    it('登录后切换到该账号独立的已读记录，退出后恢复访客记录', async () => {
      mockSuccess(buildAnnouncements())
      await refreshAnnouncements()

      // 访客已读 1 条
      markAsRead(1)
      expect(getUnreadCount()).toBe(2)

      // 登录新账号：未读记录相互独立
      await switchUser()
      expect(getUnreadCount()).toBe(3)
      markAsRead(2)
      expect(getUnreadCount()).toBe(2)

      // 退出登录：恢复访客的已读记录
      authState.isLoggedIn = false
      authState.user = null
      await nextTick()
      expect(getUnreadCount()).toBe(2)
      expect(getAllAnnouncements().find(a => a.id === '1').read).toBe(true)
      expect(getAllAnnouncements().find(a => a.id === '2').read).toBe(false)
    })

    it('已读状态写入对应用户的 localStorage 键', async () => {
      mockSuccess(buildAnnouncements())
      await refreshAnnouncements()
      await switchUser()

      markAsRead(1)

      expect(localStorage.getItem('billiard_announcement_read_guest')).toBeNull()
      const stored = JSON.parse(localStorage.getItem('billiard_announcement_read_U_TEST_' + userSeq))
      expect(stored['1']).toBeDefined()
    })

    it('返回首页重新加载后已读状态与未读数量保持一致', async () => {
      mockSuccess(buildAnnouncements())
      await refreshAnnouncements()
      markAsRead(1)
      markAsRead(2)

      // 模拟离开首页后重新挂载、重新拉取公告
      announcementState.announcements = []
      announcementState.initialized = false
      await refreshAnnouncements()

      expect(getUnreadCount()).toBe(1)
      expect(getAllAnnouncements().find(a => a.id === '1').read).toBe(true)
      expect(getAllAnnouncements().find(a => a.id === '3').read).toBe(false)
    })
  })
})
