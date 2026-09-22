<!--
  AnnouncementCenter.vue - 首页公告中心

  功能说明：
  - 展示重要通知、活动消息、系统更新三类公告
  - 未读数量徽标实时更新，已读/未读状态按用户维度持久化
  - 支持按类别筛选、按标题/摘要/内容关键词搜索
  - 点击公告查看详情并自动标记已读（重复点击幂等）
  - 公告内容更新（revision 变化）后自动恢复未读
  - 空公告、筛选/搜索无结果分别展示对应空状态
-->
<template>
  <section class="announcement-center">
    <div class="section-header">
      <div class="header-left">
        <span class="section-tag">公告中心</span>
        <h2 class="section-title">重要消息</h2>
        <span class="unread-badge" :class="{ 'is-zero': unreadCount === 0 }">
          {{ unreadCount > 99 ? '99+' : unreadCount }} 条未读
        </span>
      </div>
      <button
        class="read-all-btn"
        :disabled="unreadCount === 0"
        title="将全部公告标记为已读"
        @click="markAllRead"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span>全部已读</span>
      </button>
    </div>

    <!-- 筛选与搜索 -->
    <div class="announcement-toolbar">
      <div class="category-tabs">
        <button
          v-for="cat in categories"
          :key="cat.id"
          class="category-tab"
          :class="{ active: activeCategory === cat.id }"
          @click="activeCategory = cat.id"
        >
          <span class="tab-icon">{{ cat.icon }}</span>
          <span class="tab-name">{{ cat.name }}</span>
          <span v-if="cat.id !== 'all'" class="tab-count">{{ categoryCount(cat.id) }}</span>
        </button>
      </div>
      <div class="search-box" :class="{ focused: searchFocused }">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          v-model.trim="keyword"
          type="text"
          placeholder="搜索公告标题或内容"
          @focus="searchFocused = true"
          @blur="searchFocused = false"
        >
        <button v-if="keyword" class="search-clear" title="清空搜索" @click="keyword = ''">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- 加载中 -->
    <div v-if="loading" class="announcement-list">
      <div v-for="n in 3" :key="n" class="announcement-skeleton">
        <div class="skeleton-icon"></div>
        <div class="skeleton-body">
          <div class="skeleton-line w40"></div>
          <div class="skeleton-line w80"></div>
          <div class="skeleton-line w60"></div>
        </div>
      </div>
    </div>

    <!-- 加载失败 / 无任何公告 -->
    <div v-else-if="announcements.length === 0" class="announcement-empty">
      <div class="empty-icon">📭</div>
      <h3>暂无公告</h3>
      <p v-if="loadError">公告加载失败，请稍后重试</p>
      <p v-else>俱乐部暂时没有发布新的公告，敬请期待</p>
      <button v-if="loadError" class="retry-btn" @click="fetchAnnouncements">重新加载</button>
    </div>

    <!-- 公告列表 -->
    <div v-else-if="filteredAnnouncements.length > 0" class="announcement-list">
      <article
        v-for="item in filteredAnnouncements"
        :key="item.id"
        class="announcement-card"
        :class="{ unread: !store.isRead(item) }"
        @click="openDetail(item)"
      >
        <div class="card-category" :class="item.category">
          <span>{{ categoryMeta(item.category).icon }}</span>
        </div>
        <div class="card-body">
          <div class="card-title-row">
            <div class="card-title">
              <span v-if="item.pinned" class="pinned-tag">置顶</span>
              <span class="title-text">{{ item.title }}</span>
            </div>
            <span v-if="!store.isRead(item)" class="unread-dot" title="未读"></span>
          </div>
          <p class="card-summary">{{ item.summary }}</p>
          <div class="card-meta">
            <span class="meta-category">{{ categoryMeta(item.category).name }}</span>
            <span class="meta-divider">·</span>
            <span class="meta-time">{{ formatTime(item.publishTime) }}</span>
          </div>
        </div>
        <div class="card-arrow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </div>
      </article>
    </div>

    <!-- 筛选/搜索无结果 -->
    <div v-else class="announcement-empty">
      <div class="empty-icon">🔍</div>
      <h3>没有找到相关公告</h3>
      <p v-if="keyword">没有包含「{{ keyword }}」的公告，换个关键词试试</p>
      <p v-else>该类别下暂无公告，可切换其他类别查看</p>
      <button class="retry-btn" @click="resetFilters">重置筛选条件</button>
    </div>

    <!-- 公告详情弹窗 -->
    <Modal
      v-model="detailVisible"
      :icon="detailItem ? categoryMeta(detailItem.category).icon : '📢'"
      icon-type="info"
      :title="detailItem?.title"
      size="medium"
      :show-footer="false"
    >
      <div v-if="detailItem" class="detail-content">
        <div class="detail-meta">
          <span class="detail-category" :class="detailItem.category">
            {{ categoryMeta(detailItem.category).name }}
          </span>
          <span class="detail-time">发布于 {{ formatTime(detailItem.publishTime, true) }}</span>
          <span class="detail-status" :class="detailRead ? 'read' : 'unread'">
            {{ detailRead ? '已读' : '未读' }}
          </span>
        </div>
        <div class="detail-body">
          <p v-for="(paragraph, index) in detailParagraphs" :key="index">{{ paragraph }}</p>
        </div>
      </div>
    </Modal>
  </section>
</template>

<script>
import Modal from './Modal.vue'
import { api } from '../utils/api'
import {
  announcementStore as store,
  ANNOUNCEMENT_CATEGORIES
} from '../utils/announcements'

export default {
  name: 'AnnouncementCenter',
  components: { Modal },
  data() {
    return {
      store,
      categories: ANNOUNCEMENT_CATEGORIES,
      activeCategory: 'all',
      keyword: '',
      searchFocused: false,
      loading: true,
      loadError: false,
      detailVisible: false,
      detailItem: null
    }
  },
  computed: {
    /** 全部公告（置顶优先，再按发布时间倒序） */
    announcements() {
      return [...store.getAll()].sort((a, b) => {
        if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1
        return new Date(b.publishTime) - new Date(a.publishTime)
      })
    },
    /** 经过类别筛选与关键词搜索后的公告 */
    filteredAnnouncements() {
      const keyword = this.keyword.toLowerCase()
      return this.announcements.filter(item => {
        if (this.activeCategory !== 'all' && item.category !== this.activeCategory) {
          return false
        }
        if (!keyword) return true
        return (
          item.title.toLowerCase().includes(keyword) ||
          (item.summary || '').toLowerCase().includes(keyword) ||
          (item.content || '').toLowerCase().includes(keyword)
        )
      })
    },
    /** 全部公告中的未读数量（与当前筛选/搜索无关） */
    unreadCount() {
      return store.getUnreadCount()
    },
    /** 详情中的已读状态随弹窗内状态变化 */
    detailRead() {
      return this.detailItem ? store.isRead(this.detailItem) : true
    },
    /** 详情正文按空行/换行拆分为段落 */
    detailParagraphs() {
      if (!this.detailItem) return []
      return this.detailItem.content
        .split(/\n+/)
        .map(line => line.trim())
        .filter(Boolean)
    }
  },
  mounted() {
    // 确保进入首页时已读作用域与当前登录状态一致
    store.syncScope()
    this.fetchAnnouncements()
  },
  methods: {
    /** 拉取最新公告并同步到状态模块（返回首页时重新拉取，保证内容更新可见） */
    async fetchAnnouncements() {
      this.loading = true
      this.loadError = false
      const result = await api.getAnnouncements()
      if (result.success) {
        store.syncAnnouncements(result.data)
      } else {
        this.loadError = true
      }
      this.loading = false
    },
    /** 各类别公告数量（不受搜索影响） */
    categoryCount(categoryId) {
      return store.getAll().filter(item => item.category === categoryId).length
    },
    /** 类别元信息，未知类别兜底为通知 */
    categoryMeta(categoryId) {
      return (
        this.categories.find(cat => cat.id === categoryId) || {
          id: categoryId,
          name: '公告',
          icon: '📢'
        }
      )
    },
    /** 打开公告详情并标记已读；重复点击幂等，未读数不会重复变化 */
    openDetail(item) {
      store.markAsRead(item.id)
      this.detailItem = item
      this.detailVisible = true
    },
    /** 一键全部已读 */
    markAllRead() {
      store.markAllAsRead()
    },
    /** 重置筛选与搜索 */
    resetFilters() {
      this.activeCategory = 'all'
      this.keyword = ''
    },
    /** 时间格式化：列表显示「刚刚/x天前/日期」，详情显示完整日期 */
    formatTime(time, withTime = false) {
      const date = new Date(time)
      if (Number.isNaN(date.getTime())) return '时间未知'

      const pad = n => String(n).padStart(2, '0')
      const dateText = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

      if (withTime) {
        return `${dateText} ${pad(date.getHours())}:${pad(date.getMinutes())}`
      }

      const diffDays = Math.floor((Date.now() - date.getTime()) / 86400000)
      if (diffDays <= 0) return '今天'
      if (diffDays === 1) return '昨天'
      if (diffDays < 30) return `${diffDays} 天前`
      return dateText
    }
  }
}
</script>

<style scoped>
.announcement-center {
  padding: 5rem 0 3rem;
}

.section-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 2rem;
  flex-wrap: wrap;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.section-tag {
  display: inline-block;
  background: rgba(0, 217, 165, 0.1);
  color: var(--primary);
  padding: 0.5rem 1rem;
  border-radius: 50px;
  font-size: 0.85rem;
  font-weight: 500;
}

.section-title {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 2rem;
  font-weight: 700;
}

.unread-badge {
  background: rgba(229, 57, 53, 0.12);
  color: #ff6b6b;
  border: 1px solid rgba(229, 57, 53, 0.25);
  padding: 0.3rem 0.8rem;
  border-radius: 50px;
  font-size: 0.8rem;
  font-weight: 600;
}

.unread-badge.is-zero {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-muted);
  border-color: var(--border);
}

.read-all-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: transparent;
  color: var(--primary);
  border: 1px solid rgba(0, 217, 165, 0.3);
  padding: 0.6rem 1.1rem;
  border-radius: 10px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s;
}

.read-all-btn svg {
  width: 16px;
  height: 16px;
}

.read-all-btn:hover:not(:disabled) {
  background: rgba(0, 217, 165, 0.1);
  border-color: var(--primary);
}

.read-all-btn:disabled {
  color: var(--text-muted);
  border-color: var(--border);
  cursor: not-allowed;
}

/* 工具栏：类别 + 搜索 */
.announcement-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}

.category-tabs {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.category-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: var(--bg-card);
  color: var(--text-secondary);
  border: 1px solid var(--border);
  padding: 0.55rem 1rem;
  border-radius: 50px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s;
}

.category-tab:hover {
  color: var(--text-primary);
  border-color: var(--text-muted);
}

.category-tab.active {
  background: var(--gradient-1);
  color: var(--bg-dark);
  border-color: transparent;
  font-weight: 600;
}

.tab-count {
  font-size: 0.75rem;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 50px;
  padding: 0 0.45rem;
  line-height: 1.4;
}

.category-tab.active .tab-count {
  background: rgba(10, 10, 15, 0.18);
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 260px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 0 0.8rem;
  transition: border-color 0.3s;
}

.search-box.focused {
  border-color: var(--primary);
}

.search-icon {
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.search-box input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-size: 0.9rem;
  padding: 0.7rem 0.6rem;
  font-family: inherit;
}

.search-box input::placeholder {
  color: var(--text-muted);
}

.search-clear {
  display: flex;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0.2rem;
}

.search-clear svg {
  width: 14px;
  height: 14px;
}

.search-clear:hover {
  color: var(--text-primary);
}

/* 公告列表 */
.announcement-list {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.announcement-card {
  display: flex;
  align-items: stretch;
  gap: 1rem;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 1.25rem 1.5rem;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
}

.announcement-card:hover {
  border-color: rgba(0, 217, 165, 0.4);
  background: var(--bg-card-hover);
  transform: translateY(-2px);
}

.announcement-card.unread {
  border-color: rgba(0, 217, 165, 0.18);
}

.announcement-card.unread::before {
  content: '';
  position: absolute;
  left: 0;
  top: 16px;
  bottom: 16px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--gradient-1);
}

.card-category {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.4rem;
  flex-shrink: 0;
  align-self: center;
}

.card-category.notice {
  background: rgba(0, 217, 165, 0.12);
}

.card-category.activity {
  background: rgba(240, 147, 251, 0.12);
}

.card-category.system {
  background: rgba(102, 126, 234, 0.14);
}

.card-body {
  flex: 1;
  min-width: 0;
}

.card-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.4rem;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.title-text {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.announcement-card.unread .title-text {
  color: #fff;
}

.pinned-tag {
  flex-shrink: 0;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--bg-dark);
  background: var(--gradient-1);
  border-radius: 6px;
  padding: 0.1rem 0.4rem;
}

.unread-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ff6b6b;
  flex-shrink: 0;
  box-shadow: 0 0 8px rgba(255, 107, 107, 0.6);
}

.card-summary {
  color: var(--text-secondary);
  font-size: 0.88rem;
  line-height: 1.5;
  margin-bottom: 0.5rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
  color: var(--text-muted);
}

.meta-category {
  color: var(--text-secondary);
}

.card-arrow {
  display: flex;
  align-items: center;
  color: var(--text-muted);
  flex-shrink: 0;
  transition: all 0.3s;
}

.card-arrow svg {
  width: 18px;
  height: 18px;
}

.announcement-card:hover .card-arrow {
  color: var(--primary);
  transform: translateX(3px);
}

/* 空状态 */
.announcement-empty {
  text-align: center;
  padding: 3.5rem 1rem;
  background: var(--bg-card);
  border: 1px dashed var(--border);
  border-radius: 16px;
}

.empty-icon {
  font-size: 2.5rem;
  margin-bottom: 0.8rem;
}

.announcement-empty h3 {
  font-size: 1.05rem;
  font-weight: 600;
  margin-bottom: 0.4rem;
}

.announcement-empty p {
  color: var(--text-secondary);
  font-size: 0.88rem;
}

.retry-btn {
  margin-top: 1rem;
  background: rgba(0, 217, 165, 0.1);
  color: var(--primary);
  border: 1px solid rgba(0, 217, 165, 0.3);
  padding: 0.55rem 1.4rem;
  border-radius: 10px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s;
}

.retry-btn:hover {
  background: rgba(0, 217, 165, 0.18);
}

/* 骨架屏 */
.announcement-skeleton {
  display: flex;
  gap: 1rem;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 1.25rem 1.5rem;
}

.skeleton-icon {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}

.skeleton-body {
  flex: 1;
}

.skeleton-line {
  height: 12px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  margin-bottom: 0.7rem;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}

.skeleton-line.w40 { width: 40%; }
.skeleton-line.w80 { width: 80%; }
.skeleton-line.w60 { width: 60%; }

@keyframes skeleton-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* 详情弹窗内容 */
.detail-content {
  padding: 0.25rem 0;
}

.detail-meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding-bottom: 1rem;
  margin-bottom: 1rem;
  border-bottom: 1px solid var(--border);
  font-size: 0.82rem;
  color: var(--text-secondary);
}

.detail-category {
  color: var(--primary);
  background: rgba(0, 217, 165, 0.1);
  padding: 0.2rem 0.7rem;
  border-radius: 50px;
  font-weight: 500;
}

.detail-category.activity {
  color: #f093fb;
  background: rgba(240, 147, 251, 0.1);
}

.detail-category.system {
  color: #818cf8;
  background: rgba(102, 126, 234, 0.14);
}

.detail-status {
  margin-left: auto;
  font-weight: 500;
}

.detail-status.read {
  color: var(--text-muted);
}

.detail-status.unread {
  color: #ff6b6b;
}

.detail-body p {
  color: var(--text-primary);
  font-size: 0.95rem;
  line-height: 1.9;
  margin-bottom: 0.8rem;
  white-space: pre-wrap;
}

@media (max-width: 600px) {
  .announcement-center {
    padding: 3.5rem 0 2rem;
  }

  .section-title {
    font-size: 1.6rem;
  }

  .search-box {
    min-width: 100%;
  }

  .card-category {
    width: 40px;
    height: 40px;
    font-size: 1.1rem;
  }

  .announcement-card {
    padding: 1rem;
  }
}
</style>
