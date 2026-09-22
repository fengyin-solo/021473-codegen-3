<!--
  AnnouncementCenter.vue - 首页公告中心

  功能说明：
  - 展示重要通知、活动消息及已读/未读状态
  - 支持按类别筛选与关键词搜索
  - 单条点击查看详情并标记已读（重复点击幂等，不重复计数）
  - 支持一键全部已读
  - 定时拉取最新内容，内容更新后已读记录自动失效
  - 登录状态变化时未读数量与阅读状态按账号自动切换

  Props:
  - isLoggedIn: Boolean - 当前登录状态（仅用于展示提示，已读状态由 store 按账号隔离）
-->
<template>
  <section class="announcement-center">
    <div class="section-header">
      <div class="header-left">
        <span class="section-tag">公告中心</span>
        <h2 class="section-title">
          重要通知与活动
          <span v-if="totalUnread > 0" class="unread-badge">{{ totalUnread }}</span>
        </h2>
      </div>
      <div class="header-right">
        <button
          class="action-text-btn"
          :disabled="totalUnread === 0 || loading"
          @click="handleMarkAllRead"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          全部已读
        </button>
        <button class="icon-btn" :disabled="loading" title="刷新公告" @click="refresh">
          <svg class="refresh-icon" :class="{ spinning: loading }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10"/>
            <polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- 筛选与搜索 -->
    <div class="toolbar">
      <div class="category-tabs">
        <button
          v-for="tab in categoryTabs"
          :key="tab.key"
          class="category-tab"
          :class="{ active: activeCategory === tab.key }"
          @click="activeCategory = tab.key"
        >
          <span class="tab-icon">{{ tab.icon }}</span>
          <span>{{ tab.label }}</span>
          <span v-if="tab.unread > 0" class="tab-dot">{{ tab.unread }}</span>
        </button>
      </div>
      <div class="search-box">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          v-model.trim="keyword"
          type="text"
          placeholder="搜索公告标题或内容"
        />
        <button v-if="keyword" class="search-clear" title="清空搜索" @click="keyword = ''">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- 公告列表 -->
    <div v-if="filteredAnnouncements.length > 0" class="announcement-list">
      <article
        v-for="item in filteredAnnouncements"
        :key="item.id"
        class="announcement-card"
        :class="{ unread: !item.read, pinned: item.pinned }"
        @click="openDetail(item)"
      >
        <div class="card-indicator" :class="item.category"></div>
        <div class="card-main">
          <div class="card-title-row">
            <span v-if="!item.read" class="unread-dot" title="未读"></span>
            <h3 class="card-title">{{ item.title }}</h3>
            <span v-if="item.pinned" class="tag tag-pinned">置顶</span>
            <span v-if="item.important" class="tag tag-important">重要</span>
          </div>
          <p class="card-summary">{{ item.content }}</p>
          <div class="card-meta">
            <span class="meta-category" :class="item.category">
              {{ item.categoryIcon }} {{ item.categoryName }}
            </span>
            <span class="meta-date">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              {{ item.updatedAt }}
            </span>
          </div>
        </div>
        <div class="card-arrow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
      </article>
    </div>

    <!-- 空状态 -->
    <div v-else class="empty-state">
      <div class="empty-icon">{{ loading ? '⏳' : hasAnnouncements ? '🔍' : '📭' }}</div>
      <h3 v-if="loading">公告加载中…</h3>
      <h3 v-else-if="hasAnnouncements">没有符合条件的公告</h3>
      <h3 v-else>暂无公告</h3>
      <p v-if="!loading">
        {{ hasAnnouncements ? '换个类别或关键词试试吧' : '重要通知与活动消息会在这里展示' }}
      </p>
      <button
        v-if="hasAnnouncements && (activeCategory !== 'all' || keyword)"
        class="empty-reset-btn"
        @click="resetFilters"
      >
        清除筛选条件
      </button>
    </div>

    <!-- 公告详情弹窗 -->
    <Modal
      v-model="showDetail"
      :show-footer="false"
      size="large"
      :title="selected?.title"
    >
      <div v-if="selected" class="detail-content">
        <div class="detail-tags">
          <span class="meta-category" :class="selected.category">
            {{ selected.categoryIcon }} {{ selected.categoryName }}
          </span>
          <span v-if="selected.pinned" class="tag tag-pinned">置顶</span>
          <span v-if="selected.important" class="tag tag-important">重要</span>
        </div>
        <div class="detail-time">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          发布于 {{ selected.createdAt }}
          <span v-if="selected.updatedAt !== selected.createdAt">
            · 更新于 {{ selected.updatedAt }}
          </span>
        </div>
        <div class="detail-body">{{ selected.content }}</div>
        <div class="detail-footer">
          <button class="detail-close-btn" @click="showDetail = false">我知道了</button>
        </div>
      </div>
    </Modal>
  </section>
</template>

<script>
import Modal from './Modal.vue'
import { authState } from '../utils/auth'
import {
  announcementState,
  announcementCategories,
  refreshAnnouncements,
  getAllAnnouncements,
  markAsRead,
  markAllAsRead
} from '../utils/announcementStore'
import { logger } from '../utils/api'

/** 自动刷新间隔（毫秒） */
const AUTO_REFRESH_INTERVAL = 60000

export default {
  name: 'AnnouncementCenter',
  components: { Modal },
  props: {
    isLoggedIn: { type: Boolean, default: false }
  },
  data() {
    return {
      activeCategory: 'all',
      keyword: '',
      showDetail: false,
      selected: null,
      autoRefreshTimer: null
    }
  },
  computed: {
    loading() {
      return announcementState.loading
    },
    /** 全部公告（含已读状态） */
    announcements() {
      // 依赖 readMap / currentUserId，登录变化后自动重算
      announcementState.readMap
      announcementState.currentUserId
      return getAllAnnouncements()
    },
    hasAnnouncements() {
      return this.announcements.length > 0
    },
    /** 当前账号未读总数 */
    totalUnread() {
      return this.announcements.filter(item => !item.read).length
    },
    /** 类别筛选标签（含各类别未读数） */
    categoryTabs() {
      const countOf = key =>
        this.announcements.filter(item => !item.read && item.category === key).length
      return [
        { key: 'all', label: '全部', icon: '📰', unread: this.totalUnread },
        {
          key: 'notice',
          label: announcementCategories.notice.name,
          icon: announcementCategories.notice.icon,
          unread: countOf('notice')
        },
        {
          key: 'activity',
          label: announcementCategories.activity.name,
          icon: announcementCategories.activity.icon,
          unread: countOf('activity')
        }
      ]
    },
    /** 类别 + 关键词筛选后的公告 */
    filteredAnnouncements() {
      const word = this.keyword.toLowerCase()
      return this.announcements.filter(item => {
        if (this.activeCategory !== 'all' && item.category !== this.activeCategory) {
          return false
        }
        if (!word) return true
        return (
          item.title.toLowerCase().includes(word) ||
          item.content.toLowerCase().includes(word)
        )
      })
    }
  },
  mounted() {
    this.loadAnnouncements()
    this.startAutoRefresh()
    document.addEventListener('visibilitychange', this.handleVisibilityChange)
  },
  beforeUnmount() {
    this.stopAutoRefresh()
    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
  },
  methods: {
    /** 首次加载与手动刷新 */
    async loadAnnouncements() {
      await refreshAnnouncements()
      logger.info('公告中心已刷新', {
        userId: authState.user?.id || 'guest',
        unread: this.totalUnread
      })
    },
    refresh() {
      this.loadAnnouncements()
    },
    /**
     * 打开公告详情并标记已读
     * 标记操作幂等，重复点击同一条不会重复改变未读数量
     */
    openDetail(item) {
      this.selected = item
      this.showDetail = true
      markAsRead(item.id)
    },
    /** 一键全部已读：仅标记当前筛选范围内的未读公告 */
    handleMarkAllRead() {
      const changed = markAllAsRead(this.filteredAnnouncements)
      if (changed > 0) {
        logger.info('一键全部已读', { changed, scope: this.activeCategory })
      }
    },
    resetFilters() {
      this.activeCategory = 'all'
      this.keyword = ''
    },
    /** 定时拉取最新内容，页面不可见时暂停 */
    startAutoRefresh() {
      this.stopAutoRefresh()
      this.autoRefreshTimer = setInterval(() => {
        if (document.visibilityState === 'visible') {
          refreshAnnouncements()
        }
      }, AUTO_REFRESH_INTERVAL)
    },
    stopAutoRefresh() {
      if (this.autoRefreshTimer) {
        clearInterval(this.autoRefreshTimer)
        this.autoRefreshTimer = null
      }
    },
    /** 从其他页面切回浏览器时立即检查一次内容更新 */
    handleVisibilityChange() {
      if (document.visibilityState === 'visible' && announcementState.initialized) {
        refreshAnnouncements()
      }
    }
  }
}
</script>

<style scoped>
.announcement-center {
  padding: 4rem 0 2rem;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 1.75rem;
  gap: 1rem;
  flex-wrap: wrap;
}

.header-left {
  text-align: left;
}

.section-tag {
  display: inline-block;
  background: rgba(0, 217, 165, 0.1);
  color: var(--primary);
  padding: 0.5rem 1rem;
  border-radius: 50px;
  font-size: 0.85rem;
  font-weight: 500;
  margin-bottom: 0.75rem;
}

.section-title {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 2rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.unread-badge {
  background: linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%);
  color: #fff;
  font-size: 0.8rem;
  font-weight: 700;
  min-width: 24px;
  height: 24px;
  padding: 0 7px;
  border-radius: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: 'Inter', sans-serif;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.action-text-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-secondary);
  padding: 0.55rem 1rem;
  border-radius: 10px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.3s;
}

.action-text-btn svg {
  width: 15px;
  height: 15px;
}

.action-text-btn:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
}

.action-text-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.icon-btn {
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.3s;
}

.icon-btn:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
}

.icon-btn:disabled {
  cursor: not-allowed;
}

.icon-btn svg {
  width: 17px;
  height: 17px;
}

.refresh-icon.spinning {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 工具栏 */
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
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
  gap: 0.45rem;
  padding: 0.6rem 1.1rem;
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  border-radius: 20px;
  font-size: 0.88rem;
  cursor: pointer;
  transition: all 0.3s;
}

.category-tab:hover {
  border-color: var(--primary);
  color: var(--text-primary);
}

.category-tab.active {
  background: rgba(0, 217, 165, 0.15);
  border-color: rgba(0, 217, 165, 0.3);
  color: var(--primary);
  font-weight: 600;
}

.tab-icon {
  font-size: 0.95rem;
}

.tab-dot {
  background: #ff6b6b;
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.category-tab.active .tab-dot {
  background: var(--primary);
  color: var(--bg-dark);
}

/* 搜索框 */
.search-box {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 260px;
  flex: 1;
  max-width: 340px;
  margin-left: auto;
}

.search-icon {
  position: absolute;
  left: 14px;
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  pointer-events: none;
}

.search-box input {
  width: 100%;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 0.65rem 2.5rem 0.65rem 2.6rem;
  color: var(--text-primary);
  font-size: 0.9rem;
  outline: none;
  transition: all 0.3s;
}

.search-box input::placeholder {
  color: var(--text-muted);
}

.search-box input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(0, 217, 165, 0.1);
}

.search-clear {
  position: absolute;
  right: 10px;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-muted);
  border-radius: 50%;
  cursor: pointer;
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
  gap: 0.85rem;
}

.announcement-card {
  position: relative;
  display: flex;
  align-items: stretch;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 16px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.announcement-card:hover {
  border-color: rgba(0, 217, 165, 0.4);
  transform: translateY(-2px);
  box-shadow: var(--shadow-glow);
}

.announcement-card.unread {
  background: linear-gradient(90deg, rgba(0, 217, 165, 0.05) 0%, var(--bg-card) 40%);
}

.card-indicator {
  width: 4px;
  flex-shrink: 0;
}

.card-indicator.notice {
  background: linear-gradient(180deg, #ff6b6b 0%, #ee5a5a 100%);
}

.card-indicator.activity {
  background: var(--gradient-1);
}

.card-main {
  flex: 1;
  padding: 1.15rem 1.4rem;
  min-width: 0;
}

.card-title-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin-bottom: 0.5rem;
}

.unread-dot {
  width: 8px;
  height: 8px;
  background: #ff6b6b;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 8px rgba(255, 107, 107, 0.6);
}

.card-title {
  font-size: 1.02rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.announcement-card.unread .card-title {
  color: var(--text-primary);
}

.announcement-card:not(.unread) .card-title {
  color: var(--text-secondary);
}

.tag {
  flex-shrink: 0;
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.15rem 0.55rem;
  border-radius: 6px;
}

.tag-pinned {
  background: rgba(102, 126, 234, 0.18);
  color: #8ea0f5;
}

.tag-important {
  background: rgba(255, 107, 107, 0.15);
  color: #ff8585;
}

.card-summary {
  color: var(--text-secondary);
  font-size: 0.88rem;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 0.7rem;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 1.1rem;
  font-size: 0.78rem;
}

.meta-category {
  font-weight: 500;
}

.meta-category.notice {
  color: #ff8585;
}

.meta-category.activity {
  color: var(--primary);
}

.meta-date {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--text-muted);
}

.meta-date svg {
  width: 13px;
  height: 13px;
}

.card-arrow {
  display: flex;
  align-items: center;
  padding-right: 1.2rem;
  color: var(--text-muted);
  transition: all 0.3s;
}

.announcement-card:hover .card-arrow {
  color: var(--primary);
  transform: translateX(3px);
}

.card-arrow svg {
  width: 18px;
  height: 18px;
}

/* 空状态 */
.empty-state {
  text-align: center;
  padding: 3.5rem 2rem;
  background: var(--bg-card);
  border: 1px dashed var(--border);
  border-radius: 16px;
}

.empty-icon {
  font-size: 3rem;
  margin-bottom: 0.85rem;
  opacity: 0.6;
}

.empty-state h3 {
  font-size: 1.1rem;
  margin-bottom: 0.4rem;
}

.empty-state p {
  color: var(--text-secondary);
  font-size: 0.88rem;
  margin-bottom: 1rem;
}

.empty-reset-btn {
  background: rgba(0, 217, 165, 0.12);
  border: 1px solid rgba(0, 217, 165, 0.3);
  color: var(--primary);
  padding: 0.55rem 1.25rem;
  border-radius: 10px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.3s;
}

.empty-reset-btn:hover {
  background: rgba(0, 217, 165, 0.2);
}

/* 详情弹窗 */
.detail-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.detail-tags {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.detail-time {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--text-muted);
  font-size: 0.83rem;
}

.detail-time svg {
  width: 14px;
  height: 14px;
}

.detail-body {
  color: var(--text-primary);
  font-size: 0.95rem;
  line-height: 1.9;
  white-space: pre-wrap;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1.2rem 1.35rem;
}

.detail-footer {
  display: flex;
  justify-content: flex-end;
}

.detail-close-btn {
  background: var(--gradient-1);
  color: var(--bg-dark);
  border: none;
  padding: 0.7rem 1.8rem;
  border-radius: 10px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
}

.detail-close-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px var(--primary-glow);
}

@media (max-width: 900px) {
  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .search-box {
    max-width: none;
    margin-left: 0;
  }
}

@media (max-width: 600px) {
  .announcement-center {
    padding: 3rem 0 1rem;
  }

  .section-title {
    font-size: 1.6rem;
  }

  .card-arrow {
    display: none;
  }
}
</style>
