/**
 * 公告中心组件单元测试
 *
 * 测试范围：
 * - 公告渲染与已读/未读标识
 * - 类别筛选与关键词搜索
 * - 空公告 / 空筛选结果状态
 * - 点击查看详情并标记已读（重复点击幂等）
 * - 一键全部已读与未读角标联动
 * - 登录状态变化后未读数量切换
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'

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
import { announcementState } from '../utils/announcementStore'
import AnnouncementCenter from '../components/AnnouncementCenter.vue'

const buildAnnouncements = () => [
  {
    id: 1,
    title: '营业时间调整通知',
    content: '国庆期间营业时间调整为 09:00 - 23:00',
    category: 'notice',
    important: true,
    pinned: true,
    createdAt: '2026-09-20 10:00',
    updatedAt: '2026-09-20 10:00'
  },
  {
    id: 2,
    title: '秋季双打赛报名',
    content: '会员报名享八折优惠',
    category: 'activity',
    important: false,
    pinned: false,
    createdAt: '2026-09-18 14:30',
    updatedAt: '2026-09-18 14:30'
  },
  {
    id: 3,
    title: '系统维护公告',
    content: '凌晨进行系统升级维护',
    category: 'notice',
    important: false,
    pinned: false,
    createdAt: '2026-09-15 09:00',
    updatedAt: '2026-09-15 09:00'
  }
]

const mountComponent = () =>
  mount(AnnouncementCenter, {
    props: { isLoggedIn: authState.isLoggedIn },
    attachTo: document.body
  })

let userSeq = 0

describe('AnnouncementCenter Component', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.useRealTimers()
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
    api.getAnnouncements.mockResolvedValue({ success: true, data: buildAnnouncements() })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('加载后展示全部公告与未读角标（3 条未读）', async () => {
    const wrapper = mountComponent()
    await flushPromises()

    expect(wrapper.findAll('.announcement-card')).toHaveLength(3)
    expect(wrapper.find('.unread-badge').text()).toBe('3')
    expect(wrapper.findAll('.announcement-card.unread')).toHaveLength(3)
    wrapper.unmount()
  })

  it('空公告时展示空状态', async () => {
    api.getAnnouncements.mockResolvedValue({ success: true, data: [] })
    const wrapper = mountComponent()
    await flushPromises()

    expect(wrapper.findAll('.announcement-card')).toHaveLength(0)
    expect(wrapper.find('.empty-state h3').text()).toBe('暂无公告')
    wrapper.unmount()
  })

  it('按类别筛选：活动消息仅显示 1 条', async () => {
    const wrapper = mountComponent()
    await flushPromises()

    await wrapper.findAll('.category-tab')[2].trigger('click')

    const cards = wrapper.findAll('.announcement-card')
    expect(cards).toHaveLength(1)
    expect(wrapper.find('.card-title').text()).toBe('秋季双打赛报名')
    wrapper.unmount()
  })

  it('搜索公告标题与内容，无结果时显示空筛选状态并可重置', async () => {
    const wrapper = mountComponent()
    await flushPromises()

    const input = wrapper.find('.search-box input')
    await input.setValue('双打赛')

    expect(wrapper.findAll('.announcement-card')).toHaveLength(1)

    await input.setValue('不存在的关键词')
    expect(wrapper.findAll('.announcement-card')).toHaveLength(0)
    expect(wrapper.find('.empty-state h3').text()).toBe('没有符合条件的公告')

    await wrapper.find('.empty-reset-btn').trigger('click')
    await nextTick()
    expect(wrapper.findAll('.announcement-card')).toHaveLength(3)
    expect(wrapper.find('.search-box input').element.value).toBe('')
    wrapper.unmount()
  })

  it('点击公告打开详情并标记已读，未读数减少；重复点击不重复计数', async () => {
    const wrapper = mountComponent()
    await flushPromises()

    const cards = wrapper.findAll('.announcement-card')
    // 列表第一条为置顶的通知（id=1）
    await cards[0].trigger('click')
    await flushPromises()

    expect(wrapper.find('.unread-badge').text()).toBe('2')
    expect(document.querySelector('.detail-content')).not.toBeNull()

    // 关闭详情后再次点击同一条
    document.querySelector('.detail-close-btn').click()
    await flushPromises()
    await wrapper.findAll('.announcement-card')[0].trigger('click')
    await flushPromises()

    expect(wrapper.find('.unread-badge').text()).toBe('2')
    expect(wrapper.findAll('.announcement-card.unread')).toHaveLength(2)
    wrapper.unmount()
  })

  it('一键全部已读后角标消失、按钮禁用', async () => {
    const wrapper = mountComponent()
    await flushPromises()

    expect(wrapper.find('.unread-badge').text()).toBe('3')
    await wrapper.find('.action-text-btn').trigger('click')
    await nextTick()

    expect(wrapper.find('.unread-badge').exists()).toBe(false)
    expect(wrapper.findAll('.announcement-card.unread')).toHaveLength(0)
    expect(wrapper.find('.action-text-btn').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('登录切换账号后未读数量与阅读状态对应变化', async () => {
    const wrapper = mountComponent()
    await flushPromises()

    // 访客已读 1 条
    await wrapper.findAll('.announcement-card')[0].trigger('click')
    await nextTick()
    expect(wrapper.find('.unread-badge').text()).toBe('2')

    // 登录另一账号：未读记录独立
    userSeq += 1
    authState.isLoggedIn = true
    authState.user = { id: 'U_COMP_' + userSeq, name: '组件测试' }
    await nextTick()

    expect(wrapper.find('.unread-badge').text()).toBe('3')
    expect(wrapper.findAll('.announcement-card.unread')).toHaveLength(3)

    // 退出登录恢复访客记录
    authState.isLoggedIn = false
    authState.user = null
    await nextTick()

    expect(wrapper.find('.unread-badge').text()).toBe('2')
    wrapper.unmount()
  })

  it('内容更新（updatedAt 变化）后对应公告恢复未读', async () => {
    const data = buildAnnouncements()
    api.getAnnouncements.mockResolvedValue({ success: true, data })
    const wrapper = mountComponent()
    await flushPromises()

    await wrapper.findAll('.announcement-card')[0].trigger('click')
    await nextTick()
    expect(wrapper.find('.unread-badge').text()).toBe('2')

    // 模拟服务端更新该公告内容后自动刷新
    data[0] = { ...data[0], content: '营业时间再次调整', updatedAt: '2026-09-21 09:00' }
    api.getAnnouncements.mockResolvedValue({ success: true, data: [...data] })
    await wrapper.find('.icon-btn').trigger('click')
    await flushPromises()

    expect(wrapper.find('.unread-badge').text()).toBe('3')
    wrapper.unmount()
  })
})
