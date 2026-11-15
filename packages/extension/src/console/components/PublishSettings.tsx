import { useMemo } from 'react'
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  Check,
  Clock,
  FileText,
  Loader2,
  Send,
} from 'lucide-react'
import { useConsoleStore } from '../lib/store'
import { PlatformIcon } from './PlatformBadge'
import { SyncResults } from './SyncResults'
import {
  countUnauthenticated,
  draftPublishMode,
  isPublishable,
  isScheduleValid,
  parseDateTimeLocal,
  toDateTimeLocal,
} from '../lib/publish-flow'

/**
 * 发布设置
 *
 * 两个页签是两条不同的业务路径，不是同一张表单换个标题：
 * - 存为草稿：全部平台只写入草稿箱 → 成功后勾选 → 带入发布页
 * - 立即发布：只列可直接发布的平台 → 立即 / 定时（选时间）
 */
export function PublishSettings() {
  const {
    article,
    platforms,
    selectedPlatforms,
    publishMode,
    publishTiming,
    scheduledAt,
    draftRefs,
    selectedDraftRefs,
    scheduledJobs,
    lastRunKind,
    sync,
    setPublishMode,
    setPublishTiming,
    setScheduledAt,
    toggleDraftRef,
    carryDrafts,
    clearDraftRefs,
    startSync,
    publishSelectedDrafts,
    setNotice,
  } = useConsoleStore()

  const busy = sync.running

  const publishable = useMemo(
    () => platforms.filter(platform => platform.isAuthenticated && isPublishable(platform)),
    [platforms]
  )
  const selectedPublishable = selectedPlatforms.filter(id => publishable.some(p => p.id === id))
  // 草稿模式下列表是全量平台，选中里可能夹着未登录的，同步前提示一句
  const unauthedSelected = countUnauthenticated(platforms, selectedPlatforms)

  const autoDrafts = draftRefs.filter(ref => draftPublishMode(ref, platforms) === 'auto')
  const manualDrafts = draftRefs.filter(ref => draftPublishMode(ref, platforms) === 'manual')
  const selectedAuto = autoDrafts.filter(ref => selectedDraftRefs.includes(ref.platform))

  const scheduleAt = parseDateTimeLocal(scheduledAt)
  const scheduleReady = isScheduleValid(scheduleAt)
  const minScheduleValue = toDateTimeLocal(Date.now() + 60 * 1000)

  const draftResults = lastRunKind === 'draft' ? sync.results : []
  const publishResults = lastRunKind === 'publish' || lastRunKind === 'publish-drafts' ? sync.results : []

  const successfulDrafts = sync.results
    .filter(result => result.success && result.draftOnly !== false)
    .map(result => result.platform)

  const progressText = `${sync.results.length}/${selectedPlatforms.length} 已完成`
  const progressPercent = selectedPlatforms.length
    ? Math.round(Math.min(sync.results.length / selectedPlatforms.length, 1) * 100)
    : 0

  return (
    <section className="uga-card sticky top-4 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">发布设置</h2>
        <span className="text-[11px] text-muted-foreground">
          {publishMode === 'draft' ? '仅写入草稿箱' : publishTiming === 'schedule' ? '定时发布' : '立即发布'}
        </span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-muted p-0.5 text-sm">
        <button
          onClick={() => setPublishMode('draft')}
          className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 ${
            publishMode === 'draft' ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'
          }`}
        >
          <FileText className="h-3.5 w-3.5" /> 存为草稿
        </button>
        <button
          onClick={() => setPublishMode('publish')}
          className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 ${
            publishMode === 'publish' ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'
          }`}
        >
          <Send className="h-3.5 w-3.5" /> 立即发布
        </button>
      </div>

      {publishMode === 'draft' ? (
        <div className="space-y-3">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            只写入各平台草稿箱，不会公开发布。同步完成后可勾选成功的草稿，再带到「立即发布」。
          </p>

          <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-xs">
            <span>已选 {selectedPlatforms.length} 个平台</span>
            <span className="text-muted-foreground">全部存草稿</span>
          </div>

          {unauthedSelected > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              其中 {unauthedSelected} 个平台还没登录，会同步失败；先去「账号」页登录，或把它们取消掉。
            </p>
          )}

          <button
            className="uga-btn-primary w-full"
            disabled={busy || !article || selectedPlatforms.length === 0}
            onClick={() => startSync()}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            {busy ? '同步中…' : `同步为草稿 · ${selectedPlatforms.length} 个平台`}
          </button>

          {busy && <Progress text={progressText} percent={progressPercent} />}

          {!busy && draftResults.length > 0 && (
            <div className="space-y-3 border-t pt-3">
              <SyncResults
                results={draftResults}
                platforms={platforms}
                selectable
                selected={selectedDraftRefs}
                onToggle={toggleDraftRef}
                selectableIds={successfulDrafts}
              />
              <button
                className="uga-btn-secondary w-full"
                disabled={selectedDraftRefs.length === 0}
                onClick={() => carryDrafts(selectedDraftRefs)}
              >
                下一步：发布选中的 {selectedDraftRefs.length} 篇草稿
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {draftRefs.length > 0 ? (
            <>
              <div className="overflow-hidden rounded-lg border">
                <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
                  <span className="text-xs font-medium">待发布草稿 {draftRefs.length} 篇</span>
                  <button className="text-[11px] text-muted-foreground hover:text-foreground" onClick={clearDraftRefs}>
                    改为发布新文章
                  </button>
                </div>
                <div className="max-h-56 divide-y overflow-y-auto">
                  {draftRefs.map(ref => {
                    const mode = draftPublishMode(ref, platforms)
                    const auto = mode === 'auto'
                    const checked = auto && selectedDraftRefs.includes(ref.platform)
                    return (
                      <div
                        key={ref.platform}
                        className={`flex items-center gap-2 px-3 py-2 text-xs ${
                          auto ? 'cursor-pointer hover:bg-muted/50' : 'opacity-80'
                        }`}
                        onClick={() => auto && toggleDraftRef(ref.platform)}
                      >
                        <span
                          className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                            checked
                              ? 'border-primary bg-primary text-primary-foreground'
                              : auto
                                ? 'border-border'
                                : 'border-dashed border-border/60 bg-muted/40'
                          }`}
                        >
                          {checked && <Check className="h-3 w-3" />}
                        </span>
                        <PlatformIcon
                          platformId={ref.platform}
                          icon={platforms.find(p => p.id === ref.platform)?.icon}
                          name={ref.platformName || ref.platform}
                          size={14}
                        />
                        <span className="min-w-0 flex-1 truncate">{ref.platformName || ref.platform}</span>
                        {auto ? (
                          <span className="uga-chip border border-primary/30 text-primary">可自动发布</span>
                        ) : (
                          <span className="uga-chip bg-muted text-muted-foreground">需手动发布</span>
                        )}
                        {ref.postUrl && (
                          <a
                            href={ref.postUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={event => event.stopPropagation()}
                            className="flex-shrink-0 text-primary hover:underline"
                          >
                            打开草稿
                          </a>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              <p className="text-[11px] leading-relaxed text-muted-foreground">
                标「可自动发布」的平台会直接发布原来那篇草稿，不会新建第二篇。
                {manualDrafts.length > 0 &&
                  `其余 ${manualDrafts.length} 个平台没有草稿发布接口，请点「打开草稿」到后台发布。`}
              </p>

              <TimingPicker
                timing={publishTiming}
                scheduledAt={scheduledAt}
                minValue={minScheduleValue}
                valid={scheduleReady}
                onChangeTiming={setPublishTiming}
                onChangeTime={setScheduledAt}
              />

              <button
                className="uga-btn-primary w-full"
                disabled={busy || selectedAuto.length === 0 || (publishTiming === 'schedule' && !scheduleReady)}
                onClick={() => publishSelectedDrafts()}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : publishTiming === 'schedule' ? <Clock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                {busy
                  ? '发布中…'
                  : publishTiming === 'schedule'
                    ? `定时发布 ${selectedAuto.length} 篇草稿`
                    : `发布选中的 ${selectedAuto.length} 篇草稿`}
              </button>
            </>
          ) : (
            <>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                只列出支持自动发布的平台。仅草稿的平台请切到「存为草稿」，同步后再到平台后台发布。
              </p>

              <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-xs">
                <span>已选 {selectedPublishable.length} 个可发布平台</span>
                <span className="text-muted-foreground">共 {publishable.length} 个</span>
              </div>

              {publishable.length === 0 && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                  还没有可直发的平台，先去「账号」页登录。
                </p>
              )}

              <TimingPicker
                timing={publishTiming}
                scheduledAt={scheduledAt}
                minValue={minScheduleValue}
                valid={scheduleReady}
                onChangeTiming={setPublishTiming}
                onChangeTime={setScheduledAt}
              />

              <button
                className="uga-btn-primary w-full"
                disabled={
                  busy ||
                  !article ||
                  selectedPublishable.length === 0 ||
                  (publishTiming === 'schedule' && !scheduleReady)
                }
                onClick={() => startSync()}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : publishTiming === 'schedule' ? <Clock className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                {busy
                  ? '发布中…'
                  : publishTiming === 'schedule'
                    ? `定时发布到 ${selectedPublishable.length} 个平台`
                    : `发布到 ${selectedPublishable.length} 个平台`}
              </button>

              {selectedPublishable.length < selectedPlatforms.length && (
                <p className="text-[11px] text-muted-foreground">
                  另外 {selectedPlatforms.length - selectedPublishable.length} 个所选平台不支持自动发布，本次不会处理。
                </p>
              )}
            </>
          )}

          {busy && <Progress text={progressText} percent={progressPercent} />}

          {!busy && publishResults.length > 0 && (
            <div className="border-t pt-3">
              <SyncResults results={publishResults} platforms={platforms} />
            </div>
          )}
        </div>
      )}

      {scheduledJobs.length > 0 && (
        <button
          className="mt-3 flex w-full items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-left text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
          onClick={() =>
            setNotice({
              kind: 'info',
              text: `定时队列：${scheduledJobs
                .map(job => `${job.title} ${new Date(job.publishAt).toLocaleString('zh-CN')}`)
                .join('；')}`,
            })
          }
        >
          <CalendarClock className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="truncate">
            队列中 {scheduledJobs.length} 个任务，最近{' '}
            {new Date(scheduledJobs[0].publishAt).toLocaleString('zh-CN', {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </button>
      )}

      {sync.error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-300">
          {sync.error}
        </div>
      )}
    </section>
  )
}

function Progress({ text, percent }: { text: string; percent: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
        <span>{text}</span>
        <span>{percent}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

function TimingPicker({
  timing,
  scheduledAt,
  minValue,
  valid,
  onChangeTiming,
  onChangeTime,
}: {
  timing: 'now' | 'schedule'
  scheduledAt: string
  minValue: string
  valid: boolean
  onChangeTiming: (timing: 'now' | 'schedule') => void
  onChangeTime: (value: string) => void
}) {
  return (
    <div className="rounded-lg border p-2">
      <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-0.5 text-xs">
        <button
          onClick={() => onChangeTiming('now')}
          className={`flex items-center justify-center gap-1 rounded px-2 py-1.5 ${
            timing === 'now' ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'
          }`}
        >
          <Send className="h-3 w-3" /> 立即发布
        </button>
        <button
          onClick={() => onChangeTiming('schedule')}
          className={`flex items-center justify-center gap-1 rounded px-2 py-1.5 ${
            timing === 'schedule' ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'
          }`}
        >
          <Clock className="h-3 w-3" /> 定时发布
        </button>
      </div>

      {timing === 'schedule' && (
        <div className="mt-2 space-y-1">
          <input
            type="datetime-local"
            className="uga-input"
            value={scheduledAt}
            min={minValue}
            onChange={event => onChangeTime(event.target.value)}
          />
          {!valid ? (
            <p className="flex items-center gap-1 text-[11px] text-red-500">
              <AlertCircle className="h-3 w-3" /> 请选择至少 1 分钟之后的时间
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">到点后由浏览器在后台执行，期间请保持浏览器运行。</p>
          )}
        </div>
      )}
    </div>
  )
}
