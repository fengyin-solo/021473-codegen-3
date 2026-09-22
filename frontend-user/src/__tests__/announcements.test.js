/**
 * 公告中心状态模块单元测试
 *
 * 测试范围：
 * - 公告同步与已读/未读判断
 * - 重复点击幂等
 * - 内容更新（revision 变化）恢复未读
 * - 未读数量统计与筛选范围
 * - 登录/退出作用域隔离与持久化
 * - 返回首页（重新挂载）状态保持
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  announcementStore as store,
  ANNOUNCEMENT_CATEGORIES
} from '../utils/announcements'
import { authState } from '../utils/auth'

// ==================== 测试数据 ====================

const makeList = () => [
  { id: 'A1', category: 'notice', title: '通知一', revision: 1, pinned: true, publishTime: '2026-09-20T10:00:00Z' },
  { id: 'A2', category: 'activity', title: '活动一', revision: 1, pinned: false, publishTime: '2026-09-19T10:00:00Z' },
  { id: 'A3', category: 'system', title: '系统一', revision: 1, pinned: false, publishTime: '2026-09-18T10:00:00Z' }
]

function resetAuth() {
  authState.isLoggedIn = false
  authState.user = null
  authState.token = null
}

describe('Announcement Store', () => {
  beforeEach(() => {
    resetAuth()
    store._resetForTesting()
    store.syncScope()
  })

  // ---------- 初始与同步 ----------

  describe('syncAnnouncements', () => {
    it('默认无公告时未读数为 0', () => {
      expect(store.getAll()).toEqual([])
      expect(store.getUnreadCount()).toBe(0)
    })

    it('同步公告后全部为未读', () => {
      store.syncAnnouncements(makeList())
      expect(store.getAll().length).toBe(3)
      expect(store.getUnreadCount()).toBe(3)
      expect(store.isRead(store.getAll()[0])).toBe(false)
    })

    it('非数组输入按空列表处理', () => {
      store.syncAnnouncements(undefined)
      expect(store.getAll()).toEqual([])
      expect(store.getUnreadCount()).toBe(0)
    })

    it('清理已删除公告的已读记录', () => {
      store.syncAnnouncements(makeList())
      store.markAllAsRead()
      expect(store.getUnreadCount()).toBe(0)

      store.syncAnnouncements(makeList().slice(1))
      // A1 已删除，其已读键被清理；A2/A3 仍已读
      expect(store.getAll().length).toBe(2)
      expect(store.getUnreadCount()).toBe(0)
      store.syncAnnouncements(makeList())
      // A1 重新出现（相同 revision）时其已读记录不应复活
      expect(store.getUnreadCount()).toBe(1)
    })
  })

  // ---------- 已读操作与重复点击 ----------

  describe('markAsRead', () => {
    beforeEach(() => {
      store.syncAnnouncements(makeList())
    })

    it('标记后已读、未读数减少 1', () => {
      const changed = store.markAsRead('A1')
      expect(changed).toBe(true)
      expect(store.getUnreadCount()).toBe(2)
      const a1 = store.getAll().find(a => a.id === 'A1')
      expect(store.isRead(a1)).toBe(true)
    })

    it('重复点击同一条公告幂等，未读数不再变化', () => {
      expect(store.markAsRead('A1')).toBe(true)
      expect(store.getUnreadCount()).toBe(2)
      expect(store.markAsRead('A1')).toBe(false)
      expect(store.markAsRead('A1')).toBe(false)
      expect(store.getUnreadCount()).toBe(2)
    })

    it('标记不存在的公告返回 false', () => {
      expect(store.markAsRead('NOT_EXIST')).toBe(false)
      expect(store.getUnreadCount()).toBe(3)
    })

    it('数字ID与字符串ID等价匹配', () => {
      store.syncAnnouncements([{ id: 9, revision: 1 }])
      expect(store.markAsRead(9)).toBe(true)
      expect(store.getUnreadCount()).toBe(0)
    })
  })

  describe('markAllAsRead', () => {
    it('一次标记全部，返回变更条数', () => {
      store.syncAnnouncements(makeList())
      expect(store.markAllAsRead()).toBe(3)
      expect(store.getUnreadCount()).toBe(0)
    })

    it('全部已读后再次标记返回 0', () => {
      store.syncAnnouncements(makeList())
      store.markAllAsRead()
      expect(store.markAllAsRead()).toBe(0)
    })

    it('支持统计指定子集的未读数', () => {
      store.syncAnnouncements(makeList())
      const notices = store.getAll().filter(a => a.category === 'notice')
      expect(store.getUnreadCount(notices)).toBe(1)
      store.markAsRead('A1')
      expect(store.getUnreadCount(notices)).toBe(0)
      expect(store.getUnreadCount()).toBe(2)
    })
  })

  // ---------- 内容更新恢复未读 ----------

  describe('内容更新（revision）', () => {
    it('公告 revision 增加后已读状态失效、未读恢复', () => {
      store.syncAnnouncements(makeList())
      store.markAllAsRead()
      expect(store.getUnreadCount()).toBe(0)

      const updated = makeList().map(a =>
        a.id === 'A2' ? { ...a, revision: 2, title: '活动一（更新）' } : a
      )
      store.syncAnnouncements(updated)

      const a2 = store.getAll().find(a => a.id === 'A2')
      expect(store.isRead(a2)).toBe(false)
      expect(store.getUnreadCount()).toBe(1)
    })

    it('revision 不变时已读状态保持', () => {
      store.syncAnnouncements(makeList())
      store.markAsRead('A1')

      const republished = makeList().map(a =>
        a.id === 'A1' ? { ...a, summary: '仅摘要文案微调' } : a
      )
      store.syncAnnouncements(republished)
      const a1 = store.getAll().find(a => a.id === 'A1')
      expect(store.isRead(a1)).toBe(true)
      expect(store.getUnreadCount()).toBe(2)
    })
  })

  // ---------- 登录变化与作用域隔离 ----------

  describe('登录状态变化', () => {
    it('游客与登录用户的已读状态相互隔离', () => {
      store.syncAnnouncements(makeList())
      store.markAsRead('A1')
      expect(store.getUnreadCount()).toBe(2)

      // 模拟登录
      authState.isLoggedIn = true
      authState.user = { id: 'U20260001', name: '张三' }
      store.syncScope()

      // 登录用户视角：全部未读，游客已读不串用
      expect(store.scope).toBe('u:U20260001')
      expect(store.getUnreadCount()).toBe(3)
      store.markAsRead('A2')
      expect(store.getUnreadCount()).toBe(2)

      // 退出登录回到游客视角：A1 已读仍保留
      resetAuth()
      store.syncScope()
      expect(store.scope).toBe('guest')
      expect(store.getUnreadCount()).toBe(2)
      expect(store.isRead(store.getAll().find(a => a.id === 'A1'))).toBe(true)
      expect(store.isRead(store.getAll().find(a => a.id === 'A2'))).toBe(false)
    })

    it('不同登录用户之间已读状态隔离', () => {
      store.syncAnnouncements(makeList())

      authState.isLoggedIn = true
      authState.user = { id: 'U1' }
      store.syncScope()
      store.markAllAsRead()
      expect(store.getUnreadCount()).toBe(0)

      authState.user = { id: 'U2' }
      store.syncScope()
      expect(store.getUnreadCount()).toBe(3)
    })
  })

  // ---------- 持久化：返回首页 / 刷新 ----------

  describe('持久化', () => {
    it('已读状态写入 localStorage，重建状态后保持一致', () => {
      store.syncAnnouncements(makeList())
      store.markAsRead('A1')
      store.markAsRead('A3')

      const raw = localStorage.getItem('billiard_announcements_read__guest')
      expect(raw).toBeTruthy()
      const saved = JSON.parse(raw)
      expect(Object.keys(saved)).toEqual(['A1@1', 'A3@1'])

      // 模拟页面刷新/返回首页：模块状态重建后从 localStorage 恢复
      // （通过切换作用域再切回，触发从存储重新加载）
      authState.isLoggedIn = true
      authState.user = { id: 'U_TEMP' }
      store.syncScope()
      resetAuth()
      store.syncScope()

      store.syncAnnouncements(makeList())
      expect(store.getUnreadCount()).toBe(1)
      expect(store.isRead(store.getAll().find(a => a.id === 'A2'))).toBe(false)
    })

    it('损坏的本地数据不导致异常', () => {
      localStorage.setItem('billiard_announcements_read__guest', '{bad json')
      expect(() => store.syncScope()).not.toThrow()
      store.syncAnnouncements(makeList())
      expect(store.getUnreadCount()).toBe(3)
    })
  })

  // ---------- 类别配置 ----------

  describe('类别配置', () => {
    it('包含全部及三类业务公告', () => {
      const ids = ANNOUNCEMENT_CATEGORIES.map(c => c.id)
      expect(ids).toEqual(['all', 'notice', 'activity', 'system'])
    })
  })
})
