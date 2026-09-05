'use client'

import {
  CalendarDays,
  CheckCircle2,
  LayoutGrid,
  ListChecks,
  Plus,
  TrendingUp,
} from 'lucide-react'

import type { ChecklistStats, ChecklistSummary } from '@shared/types'
import { describeDue } from '@/lib/format'
import {
  CHECKLIST_KIND_META,
  DEADLINE_ICON,
  RANGE_LABEL,
  dayNumber,
  eachDay,
  formatDayLong,
  formatDayShort,
  isToday,
  progressLabel,
  progressTone,
  todayDay,
  weekdayShort,
  type StatsRange,
} from '@/lib/checklists'
import { useVault } from '@/lib/store'
import { Button, EmptyState, ProgressBar, ProgressRing, Spinner } from './ui'

/** Due-date chip colours, shared with the notes list and the detail pane. */
const DUE_TONE: Record<string, string> = {
  overdue: 'bg-danger/15 text-danger',
  today: 'bg-amber-400/15 text-amber-300',
  soon: 'bg-accent-soft text-accent',
  later: 'bg-surface-2 text-ink-3',
}

/**
 * The checklist dashboard: the numbers first, then the two kinds of plan.
 *
 * The numbers come first because the question this screen answers is "how am I
 * doing", not "what exists" — the lists below are the detail behind the four
 * tiles at the top, and both halves respond to the same week/month switch.
 *
 * Every figure on this screen is computed in the main process (`checklist:stats`).
 * Nothing here re-tallies anything: a percentage the UI worked out for itself
 * is a percentage that can disagree with the one on the card next to it.
 */
export function ChecklistDashboard({
  onCreate,
}: {
  onCreate: (kind: 'daily' | 'module') => void
}) {
  const {
    checklistStats,
    dailyChecklists,
    moduleChecklists,
    checklistsLoading,
    checklistRange,
    setChecklistRange,
    openChecklist,
  } = useVault()

  const today = todayDay()
  const todayPlan = dailyChecklists.find((plan) => plan.day === today)

  if (checklistsLoading && checklistStats === null) return <Spinner />

  return (
    <div className="px-6 py-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div id="checklist-range" className="flex gap-1.5">
          {(['week', 'month'] as const).map((value) => (
            <RangeChip
              key={value}
              id={`btn-checklist-range-${value}`}
              active={checklistRange === value}
              onClick={() => setChecklistRange(value)}
            >
              {RANGE_LABEL[value]}
            </RangeChip>
          ))}
        </div>

        {checklistStats && (
          <span className="text-xs text-ink-3">
            {formatDayShort(checklistStats.from)} – {formatDayShort(checklistStats.to)}
          </span>
        )}

        {!todayPlan && (
          <Button
            id="btn-plan-today"
            variant="primary"
            className="ml-auto"
            onClick={() => onCreate('daily')}
          >
            <Plus className="size-4" />
            Lên kế hoạch hôm nay
          </Button>
        )}
      </div>

      {checklistStats && <StatTiles stats={checklistStats} range={checklistRange} />}

      {/* ---------------------------------------------------------- daily */}

      <Section
        icon={CalendarDays}
        title="Checklist theo ngày"
        hint="Mỗi ngày một checklist. Việc lớn có thể chia thành việc nhỏ."
        action={
          <Button id="btn-add-daily-checklist" variant="subtle" onClick={() => onCreate('daily')}>
            <Plus className="size-4" />
            Checklist ngày
          </Button>
        }
      >
        {checklistStats && (
          <RangeChart stats={checklistStats} onOpen={(id) => void openChecklist(id)} />
        )}

        {dailyChecklists.length === 0 ? (
          <EmptyState
            id="empty-daily-checklists"
            icon={CalendarDays}
            title={`Chưa có checklist nào trong ${RANGE_LABEL[checklistRange].toLowerCase()}`}
            description="Lên lịch các việc cần hoàn thành trong ngày, rồi tick dần khi xong. Mỗi ngày chỉ có một checklist."
            action={
              <Button id="btn-add-daily-empty" variant="primary" onClick={() => onCreate('daily')}>
                <Plus className="size-4" />
                Tạo checklist ngày
              </Button>
            }
          />
        ) : (
          <div
            id="grid-daily-checklists"
            className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]"
          >
            {dailyChecklists.map((plan) => (
              <DailyCard key={plan.id} plan={plan} onOpen={() => void openChecklist(plan.id)} />
            ))}
          </div>
        )}
      </Section>

      {/* --------------------------------------------------------- module */}

      <Section
        icon={LayoutGrid}
        title="Checklist theo module"
        hint="Khối công việc dài ngày, tự sắp xếp theo ma trận Eisenhower."
        action={
          <Button id="btn-add-module-checklist" variant="subtle" onClick={() => onCreate('module')}>
            <Plus className="size-4" />
            Checklist module
          </Button>
        }
      >
        {moduleChecklists.length === 0 ? (
          <EmptyState
            id="empty-module-checklists"
            icon={LayoutGrid}
            title="Chưa có checklist module nào"
            description="Khi nhận một khối công việc lớn — 40 đầu việc trong hai tháng chẳng hạn — hãy gom vào một checklist module thay vì chia lẻ theo ngày."
            action={
              <Button
                id="btn-add-module-empty"
                variant="primary"
                onClick={() => onCreate('module')}
              >
                <Plus className="size-4" />
                Tạo checklist module
              </Button>
            }
          />
        ) : (
          <div
            id="grid-module-checklists"
            className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]"
          >
            {moduleChecklists.map((plan) => (
              <ModuleCard key={plan.id} plan={plan} onOpen={() => void openChecklist(plan.id)} />
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

function StatTiles({ stats, range }: { stats: ChecklistStats; range: StatsRange }) {
  const window = RANGE_LABEL[range].toLowerCase()

  return (
    <div id="checklist-stats" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Tile
        id="stat-checklist-count"
        icon={CalendarDays}
        label={`Checklist ${window}`}
        value={String(stats.daily.checklistCount)}
        hint={`${stats.daily.completedCount} ngày hoàn thành 100%`}
      />
      <Tile
        id="stat-checklist-percent"
        icon={TrendingUp}
        label="Tiến độ trung bình"
        value={`${stats.daily.percent}%`}
        hint={`${stats.daily.taskDone}/${stats.daily.taskTotal} việc đã xong`}
        percent={stats.daily.percent}
      />
      <Tile
        id="stat-checklist-tasks"
        icon={ListChecks}
        label="Việc còn lại"
        value={String(Math.max(0, stats.daily.taskTotal - stats.daily.taskDone))}
        hint={`trong ${stats.daily.taskTotal} việc của ${window}`}
      />
      <Tile
        id="stat-module-progress"
        icon={LayoutGrid}
        label="Module đang theo"
        value={String(stats.module.checklistCount - stats.module.completedCount)}
        hint={`${stats.module.percent}% tổng tiến độ · ${stats.module.completedCount} đã xong`}
        percent={stats.module.percent}
      />
    </div>
  )
}

function Tile({
  id,
  icon: Icon,
  label,
  value,
  hint,
  percent,
}: {
  id: string
  icon: typeof CalendarDays
  label: string
  value: string
  hint: string
  percent?: number
}) {
  return (
    <div id={id} className="rounded-[14px] border border-surface-3 bg-surface-1 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Icon className="size-4 text-ink-3" aria-hidden />
        <span className="truncate text-xs text-ink-3">{label}</span>
      </div>
      <p className="text-2xl font-semibold tabular-nums text-ink-1">{value}</p>
      {percent !== undefined && (
        <ProgressBar
          percent={percent}
          tone={progressTone(percent)}
          label={`${label}: ${percent}%`}
          className="mt-2.5"
        />
      )}
      <p className="mt-2 truncate text-[11px] text-ink-3" title={hint}>
        {hint}
      </p>
    </div>
  )
}

/**
 * One bar per day of the window.
 *
 * Every day is drawn, including the ones with no plan — a gap in the row is
 * the most useful thing this chart says, and a chart that only shows the days
 * you did well is a chart that cannot say it.
 */
function RangeChart({
  stats,
  onOpen,
}: {
  stats: ChecklistStats
  onOpen: (checklistId: string) => void
}) {
  const days = eachDay(stats.from, stats.to)
  const byDay = new Map(stats.daily.days.map((entry) => [entry.day, entry]))

  return (
    <div
      id="chart-checklist-range"
      className="mb-4 flex items-end gap-1 overflow-x-auto rounded-[14px] border border-surface-3 bg-surface-1 px-4 pb-3 pt-4"
    >
      {days.map((day) => {
        const entry = byDay.get(day)
        const percent = entry?.percent ?? 0
        const today = isToday(day)
        const title = entry
          ? `${formatDayLong(day)} — ${entry.done}/${entry.total} việc (${percent}%)`
          : `${formatDayLong(day)} — chưa có checklist`

        return (
          <button
            key={day}
            id={`bar-day-${day}`}
            title={title}
            aria-label={title}
            disabled={!entry}
            onClick={() => entry && onOpen(entry.checklistId)}
            className={`group flex min-w-[26px] flex-1 flex-col items-center gap-1.5
              ${entry ? 'cursor-pointer' : 'cursor-default'}`}
          >
            <span className="text-[10px] tabular-nums text-ink-3">{entry ? percent : ''}</span>
            <span className="flex h-20 w-full items-end justify-center">
              <span
                className="w-full rounded-t-[4px] transition-[height] duration-300 group-hover:brightness-125"
                style={{
                  // A day with a plan but nothing done still gets a sliver, so
                  // "planned nothing" and "planned and did nothing" look
                  // different — they are.
                  height: entry ? `${Math.max(4, percent)}%` : '3px',
                  background: entry ? progressTone(percent) : 'var(--color-surface-3)',
                }}
              />
            </span>
            <span
              className={`text-[10px] leading-none ${today ? 'font-semibold text-accent' : 'text-ink-3'}`}
            >
              {weekdayShort(day)}
            </span>
            <span
              className={`text-[10px] leading-none tabular-nums ${today ? 'font-semibold text-accent' : 'text-ink-3'}`}
            >
              {dayNumber(day)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function DailyCard({ plan, onOpen }: { plan: ChecklistSummary; onOpen: () => void }) {
  const today = plan.day !== null && isToday(plan.day)
  const complete = plan.progress.total > 0 && plan.progress.done === plan.progress.total

  return (
    <button
      id={`card-checklist-${plan.id}`}
      onClick={onOpen}
      className={`flex flex-col rounded-[14px] border bg-surface-1 p-4 text-left transition
        ${today ? 'border-accent/60' : 'border-surface-3 hover:border-accent/40'}`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            {today && (
              <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                Hôm nay
              </span>
            )}
            {complete && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-success">
                <CheckCircle2 className="size-3" aria-hidden />
                Hoàn thành
              </span>
            )}
          </div>
          <h3 className="truncate text-sm font-medium text-ink-1">
            {plan.day ? formatDayLong(plan.day) : '—'}
          </h3>
          <p className="mt-1 text-xs text-ink-3">
            {plan.taskCount} việc lớn · {progressLabel(plan.progress)}
          </p>
        </div>

        <ProgressRing
          percent={plan.progress.percent}
          tone={progressTone(plan.progress.percent)}
          label={progressLabel(plan.progress)}
        />
      </div>

      {plan.description && (
        <p className="mt-2.5 line-clamp-2 text-xs leading-relaxed text-ink-3">{plan.description}</p>
      )}

      <ProgressBar
        percent={plan.progress.percent}
        tone={progressTone(plan.progress.percent)}
        label={progressLabel(plan.progress)}
        className="mt-3"
      />
    </button>
  )
}

function ModuleCard({ plan, onOpen }: { plan: ChecklistSummary; onOpen: () => void }) {
  const meta = CHECKLIST_KIND_META.module
  const due = plan.dueAt ? describeDue(plan.dueAt) : null
  const complete = plan.progress.total > 0 && plan.progress.done === plan.progress.total

  return (
    <button
      id={`card-checklist-${plan.id}`}
      onClick={onOpen}
      className="flex flex-col rounded-[14px] border border-surface-3 bg-surface-1 p-4 text-left transition hover:border-accent/40"
    >
      <div className="mb-2 flex items-center gap-2">
        <meta.icon className="size-3.5 shrink-0" style={{ color: meta.color }} aria-hidden />
        <span className="truncate text-xs text-ink-3">{meta.label}</span>

        {due && (
          <span
            className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
              complete ? 'bg-surface-2 text-ink-3' : DUE_TONE[due.tone]
            }`}
          >
            <DEADLINE_ICON className="size-3" aria-hidden />
            {due.label}
          </span>
        )}
      </div>

      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-medium leading-snug text-ink-1">
            {plan.title ?? '—'}
          </h3>
          {plan.description && (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-3">
              {plan.description}
            </p>
          )}
        </div>

        <ProgressRing
          percent={plan.progress.percent}
          tone={progressTone(plan.progress.percent)}
          label={progressLabel(plan.progress)}
        />
      </div>

      <ProgressBar
        percent={plan.progress.percent}
        tone={progressTone(plan.progress.percent)}
        label={progressLabel(plan.progress)}
        className="mt-3"
      />
      <p className="mt-2 text-[11px] text-ink-3">
        {plan.taskCount} đầu việc · {progressLabel(plan.progress)}
      </p>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

function Section({
  icon: Icon,
  title,
  hint,
  action,
  children,
}: {
  icon: typeof CalendarDays
  title: string
  hint: string
  action: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-3">
        <Icon className="size-4 shrink-0 text-ink-3" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink-1">{title}</h2>
          <p className="truncate text-xs text-ink-3">{hint}</p>
        </div>
        <div className="ml-auto shrink-0">{action}</div>
      </div>
      {children}
    </section>
  )
}

function RangeChip({
  id,
  active,
  onClick,
  children,
}: {
  id: string
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      id={id}
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 text-xs transition
        ${
          active
            ? 'border-accent bg-accent-soft text-ink-1'
            : 'border-surface-3 text-ink-2 hover:border-ink-3'
        }`}
    >
      {children}
    </button>
  )
}
