/**
 * 定时发布服务
 *
 * 使用 chrome.alarms 在指定时间唤醒 service worker 执行同步/发布。
 * 任务持久化在 chrome.storage.local，浏览器重启后自动重新挂载。
 */
import { createLogger } from '../lib/logger'
import { performSync, generateSyncId, type SyncResult } from './sync-service'

const logger = createLogger('ScheduleService')

export const SCHEDULE_KEY = 'scheduledJobs'
export const SCHEDULE_ALARM_PREFIX = 'ugaeo_scheduled_'

/** 最小提前量：至少 1 分钟后执行 */
const MIN_LEAD_MS = 60 * 1000

export interface ScheduledJob {
  id: string
  title: string
  cover?: string
  article: {
    title: string
    content?: string
    html?: string
    markdown?: string
    cover?: string
    summary?: string
    tags?: string[]
    source?: { url?: string; platform?: string }
    platformContents?: Record<string, { html: string; markdown: string }>
  }
  platforms: string[]
  /** 计划执行时间戳 */
  publishAt: number
  /** 每个平台是否保存为草稿（false = 直接发布） */
  draftOnlyByPlatform?: Record<string, boolean>
  createdAt: number
}

export interface ScheduledJobResult {
  jobId: string
  title: string
  finishedAt: number
  results: SyncResult[]
}

export const LAST_SCHEDULED_RESULT_KEY = 'lastScheduledResult'

async function readJobs(): Promise<ScheduledJob[]> {
  const storage = await chrome.storage.local.get(SCHEDULE_KEY)
  return (storage[SCHEDULE_KEY] as ScheduledJob[]) || []
}

async function writeJobs(jobs: ScheduledJob[]): Promise<void> {
  await chrome.storage.local.set({ [SCHEDULE_KEY]: jobs })
}

export async function listScheduledJobs(): Promise<ScheduledJob[]> {
  const jobs = await readJobs()
  return jobs
    .filter(job => job.publishAt > Date.now() - 24 * 60 * 60 * 1000)
    .sort((a, b) => a.publishAt - b.publishAt)
}

/**
 * 新增定时任务
 */
export async function addScheduledJob(input: {
  article: ScheduledJob['article']
  platforms: string[]
  publishAt: number
  draftOnlyByPlatform?: Record<string, boolean>
}): Promise<ScheduledJob> {
  const publishAt = Math.max(input.publishAt, Date.now() + MIN_LEAD_MS)
  const job: ScheduledJob = {
    id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: input.article.title || '未命名文章',
    cover: input.article.cover,
    article: input.article,
    platforms: input.platforms,
    publishAt,
    draftOnlyByPlatform: input.draftOnlyByPlatform,
    createdAt: Date.now(),
  }

  const jobs = await readJobs()
  await writeJobs([...jobs, job])

  await chrome.alarms.create(`${SCHEDULE_ALARM_PREFIX}${job.id}`, { when: publishAt })
  logger.info(`Scheduled job ${job.id} at ${new Date(publishAt).toLocaleString()}`)

  return job
}

/**
 * 取消定时任务
 */
export async function cancelScheduledJob(id: string): Promise<boolean> {
  const jobs = await readJobs()
  const next = jobs.filter(job => job.id !== id)
  if (next.length === jobs.length) return false

  await writeJobs(next)
  await chrome.alarms.clear(`${SCHEDULE_ALARM_PREFIX}${id}`)
  logger.info(`Cancelled scheduled job ${id}`)
  return true
}

/**
 * 执行已到点的任务
 */
export async function runScheduledJob(id: string): Promise<ScheduledJobResult | null> {
  const jobs = await readJobs()
  const job = jobs.find(j => j.id === id)
  if (!job) {
    logger.warn(`Scheduled job ${id} not found`)
    return null
  }

  // 先移除，避免重复执行
  await writeJobs(jobs.filter(j => j.id !== id))
  await chrome.alarms.clear(`${SCHEDULE_ALARM_PREFIX}${id}`)

  logger.info(`Running scheduled job ${id} - ${job.title}`)

  const syncId = generateSyncId()
  const { results } = await performSync(
    job.article,
    job.platforms,
    {
      source: 'schedule',
      syncId,
      draftOnlyByPlatform: job.draftOnlyByPlatform,
    },
    {
      onResult: result => {
        logger.debug(`Scheduled ${result.platform}:`, result.success ? 'ok' : result.error)
      },
    }
  )

  const payload: ScheduledJobResult = {
    jobId: job.id,
    title: job.title,
    finishedAt: Date.now(),
    results,
  }
  await chrome.storage.local.set({ [LAST_SCHEDULED_RESULT_KEY]: payload })

  const successCount = results.filter(r => r.success).length
  try {
    await chrome.action.setBadgeText({ text: successCount > 0 ? '⏰' : '!' })
    await chrome.action.setBadgeBackgroundColor({ color: successCount > 0 ? '#22C55E' : '#EF4444' })
    setTimeout(() => chrome.action.setBadgeText({ text: '' }).catch(() => {}), 8000)
  } catch {
    // ignore
  }

  return payload
}

/**
 * 启动时重新挂载未来任务（浏览器重启 / service worker 冷启动）
 */
export async function initScheduledJobs(): Promise<void> {
  const jobs = await readJobs()
  const now = Date.now()
  let restored = 0

  for (const job of jobs) {
    if (job.publishAt <= now - 1000) {
      // 已经过期的任务：直接补执行一次
      runScheduledJob(job.id).catch(error => logger.error('Run overdue job failed:', error))
      continue
    }
    await chrome.alarms.create(`${SCHEDULE_ALARM_PREFIX}${job.id}`, { when: job.publishAt })
    restored++
  }

  if (restored > 0) logger.info(`Restored ${restored} scheduled jobs`)
}

/**
 * 处理 alarm 事件
 */
export function handleScheduledAlarm(alarmName: string): void {
  // 兼容改名前创建的旧 alarm（wechatsync_scheduled_*），避免升级后任务丢失
  const LEGACY_PREFIX = 'wechatsync_scheduled_'
  const prefix = alarmName.startsWith(SCHEDULE_ALARM_PREFIX)
    ? SCHEDULE_ALARM_PREFIX
    : alarmName.startsWith(LEGACY_PREFIX)
      ? LEGACY_PREFIX
      : null
  if (!prefix) return
  const id = alarmName.slice(prefix.length)
  runScheduledJob(id).catch(error => logger.error('Scheduled job failed:', error))
}
