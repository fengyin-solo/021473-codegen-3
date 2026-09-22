/**
 * 公告中心组件测试
 *
 * 覆盖：
 * - 公告渲染、未读徽标
 * - 类别筛选与搜索（含空结果）
 * - 点击详情标记已读、重复点击幂等
 * - 全部已读
 * - 空公告 / 加载失败
 * - 登录变化后未读隔离
 * - 重新拉取内容（模拟返回首页）与 revision 更新恢复未读
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import AnnouncementCenter from '../components/AnnouncementCenter.vue'
import { announcementStore as store } from '../utils/announcements'
import { authState } from '../utils/auth'

// ==================== Mock API ====================

let mockAnnouncements = []
let mockShouldFail = false

vi.mock('../utils/api', () => ({
  api: {
    getAnnouncements: vi.fn(async () => {
      if (mockShouldFail) return { success: false, error: 'network error' }
      return { success: true, data: mockAnnouncements }
    })
  }
}))

// ==================== 测试数据 ====================

const baseList = () => [
  { id: 'A1', category: 'notice', title: '营业时间调整', summary: '国庆延长营业', content: '详细通知内容', revision: 1, pinned: true, publishTime: '2026-09-21T10:00:00Z' },
  { id: 'A2', category: 'activity', title: '双打赛报名', summary: '报名送畅打卡', content: '活动详情正文', revision: 1, pinned: false, publishTime: '2026-09-20T10:00:00Z' },
  { id: 'A3', category: 'system', title: '系统升级', summary: '提前7天预约', content: '更新说明', revision: 1, pinned: false, publishTime: '2026-09-19T10:00:00Z' }
]

function resetAuth() {
  authState.isLoggedIn = false
  authState.user = null
  authState.token = null
}

async function mountCenter() {
  const wrapper = mount(AnnouncementCenter)
  await flushPromises()
  await nextTick()
  return wrapper
}

describe('AnnouncementCenter 组件', () => {
  beforeEach(() => {
    resetAuth()
    store._resetForTesting()
    store.syncScope()
    mockAnnouncements = baseList()
    mockShouldFail = false
  })

  it('加载后渲染公告并显示正确未读数量', async () => {
    const wrapper = await mountCenter()

    expect(wrapper.findAll('.announcement-card').length).toBe(3)
    expect(wrapper.find('.unread-badge').text()).toContain('3 条未读')
    expect(wrapper.findAll('.unread-dot').length).toBe(3)
    // 置顶公告排在最前
    expect(wrapper.findAll('.title-text')[0].text()).toBe('营业时间调整')
  })

  it('按类别筛选并显示各类别数量', async () => {
    const wrapper = await mountCenter()

    const tabs = wrapper.findAll('.category-tab')
    await tabs[2].trigger('click') // 活动消息
    await nextTick()

    const cards = wrapper.findAll('.announcement-card')
    expect(cards.length).toBe(1)
    expect(cards[0].text()).toContain('双打赛报名')
    expect(wrapper.find('.unread-badge').text()).toContain('3 条未读') // 总未读不受筛选影响

    await tabs[0].trigger('click') // 全部
    await nextTick()
    expect(wrapper.findAll('.announcement-card').length).toBe(3)
  })

  it('按关键词搜索公告标题和内容，无结果时显示空状态', async () => {
    const wrapper = await mountCenter()

    const input = wrapper.find('.search-box input')
    await input.setValue('双打')
    await nextTick()
    expect(wrapper.findAll('.announcement-card').length).toBe(1)

    await input.setValue('不存在的关键词xyz')
    await nextTick()
    expect(wrapper.findAll('.announcement-card').length).toBe(0)
    expect(wrapper.find('.announcement-empty').text()).toContain('没有找到相关公告')

    // 重置筛选恢复列表
    await wrapper.find('.announcement-empty .retry-btn').trigger('click')
    await nextTick()
    expect(wrapper.findAll('.announcement-card').length).toBe(3)
    expect(wrapper.find('.search-box input').element.value).toBe('')
  })

  it('点击公告打开详情并标记已读，重复点击未读数不再变化', async () => {
    const wrapper = await mountCenter()

    const cards = wrapper.findAll('.announcement-card')
    await cards[0].trigger('click')
    await nextTick()

    // 未读数减少、红点消失
    expect(wrapper.find('.unread-badge').text()).toContain('2 条未读')
    expect(wrapper.findAll('.announcement-card')[0].findAll('.unread-dot').length).toBe(0)

    // 详情弹窗打开（Modal 内容 teleport 到 body）
    expect(document.body.textContent).toContain('营业时间调整')
    expect(document.body.textContent).toContain('详细通知内容')

    // 重复点击同一条：幂等
    await wrapper.findAll('.announcement-card')[0].trigger('click')
    await nextTick()
    expect(wrapper.find('.unread-badge').text()).toContain('2 条未读')
  })

  it('全部已读按钮一次性清除未读并禁用', async () => {
    const wrapper = await mountCenter()

    const btn = wrapper.find('.read-all-btn')
    expect(btn.attributes('disabled')).toBeUndefined()
    await btn.trigger('click')
    await nextTick()

    expect(wrapper.find('.unread-badge').text()).toContain('0 条未读')
    expect(wrapper.findAll('.unread-dot').length).toBe(0)
    expect(wrapper.find('.read-all-btn').attributes('disabled')).toBeDefined()
  })

  it('没有任何公告时显示空公告状态', async () => {
    mockAnnouncements = []
    const wrapper = await mountCenter()

    expect(wrapper.find('.announcement-empty').exists()).toBe(true)
    expect(wrapper.find('.announcement-empty').text()).toContain('暂无公告')
    expect(wrapper.findAll('.announcement-card').length).toBe(0)
    expect(wrapper.find('.unread-badge').text()).toContain('0 条未读')
  })

  it('加载失败时展示重试入口', async () => {
    mockShouldFail = true
    const wrapper = await mountCenter()

    expect(wrapper.find('.announcement-empty').text()).toContain('加载失败')
    expect(wrapper.find('.retry-btn').exists()).toBe(true)

    mockShouldFail = false
    await wrapper.find('.retry-btn').trigger('click')
    await flushPromises()
    await nextTick()
    expect(wrapper.findAll('.announcement-card').length).toBe(3)
  })

  it('登录变化后未读数量与阅读状态切换到用户作用域', async () => {
    const wrapper = await mountCenter()

    // 游客读一条
    await wrapper.findAll('.announcement-card')[0].trigger('click')
    await nextTick()
    expect(wrapper.find('.unread-badge').text()).toContain('2 条未读')

    // 登录后应视为全新视角，全部未读
    authState.isLoggedIn = true
    authState.user = { id: 'U20260001', name: '张三' }
    await nextTick()
    await nextTick()
    expect(wrapper.find('.unread-badge').text()).toContain('3 条未读')
    expect(wrapper.findAll('.unread-dot').length).toBe(3)

    // 退出登录回到游客视角，已读状态保持
    resetAuth()
    await nextTick()
    await nextTick()
    expect(wrapper.find('.unread-badge').text()).toContain('2 条未读')
  })

  it('返回首页重新拉取时，内容 revision 更新会恢复该公告未读', async () => {
    // 首次进入全部已读
    let wrapper = await mountCenter()
    await wrapper.find('.read-all-btn').trigger('click')
    await nextTick()
    expect(wrapper.find('.unread-badge').text()).toContain('0 条未读')

    // 模拟公告内容更新（A2 revision 增加），重新挂载组件（返回首页）
    mockAnnouncements = baseList().map(a =>
      a.id === 'A2' ? { ...a, revision: 2, title: '双打赛报名（新增奖品）' } : a
    )
    wrapper.unmount()
    wrapper = await mountCenter()

    expect(wrapper.find('.unread-badge').text()).toContain('1 条未读')
    expect(wrapper.findAll('.unread-dot').length).toBe(1)
    expect(wrapper.text()).toContain('新增奖品')
  })
})
