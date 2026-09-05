/**
 * Error codes crossing the IPC boundary.
 *
 * The rule mirrors the one used on the PFM project: the `message` field is for
 * the developer and the log. The UI renders text looked up from `code` — see
 * `renderer/src/lib/messages.ts`. Adding a code here and to that catalogue
 * happens in the same commit.
 *
 * Format: UPPER_SNAKE_CASE, prefixed with the resource it concerns.
 */
export const ErrorCode = {
  // generic
  UNKNOWN: 'UNKNOWN',
  VALIDATION_FAILED: 'VALIDATION_FAILED',

  // category
  CATEGORY_NOT_FOUND: 'CATEGORY_NOT_FOUND',
  CATEGORY_NAME_REQUIRED: 'CATEGORY_NAME_REQUIRED',
  CATEGORY_NAME_TOO_LONG: 'CATEGORY_NAME_TOO_LONG',
  CATEGORY_NAME_DUPLICATE: 'CATEGORY_NAME_DUPLICATE',
  CATEGORY_NOT_EMPTY: 'CATEGORY_NOT_EMPTY',

  // item
  ITEM_NOT_FOUND: 'ITEM_NOT_FOUND',
  ITEM_TITLE_REQUIRED: 'ITEM_TITLE_REQUIRED',
  ITEM_TITLE_TOO_LONG: 'ITEM_TITLE_TOO_LONG',

  // note
  NOTE_NOT_FOUND: 'NOTE_NOT_FOUND',
  NOTE_TITLE_REQUIRED: 'NOTE_TITLE_REQUIRED',
  NOTE_TITLE_TOO_LONG: 'NOTE_TITLE_TOO_LONG',
  NOTE_DUE_INVALID: 'NOTE_DUE_INVALID',
  NOTE_DUE_REQUIRED: 'NOTE_DUE_REQUIRED',

  // checklist
  CHECKLIST_NOT_FOUND: 'CHECKLIST_NOT_FOUND',
  CHECKLIST_TITLE_REQUIRED: 'CHECKLIST_TITLE_REQUIRED',
  CHECKLIST_TITLE_TOO_LONG: 'CHECKLIST_TITLE_TOO_LONG',
  /** A `daily` plan carries a title, or a `module` plan carries a day. */
  CHECKLIST_TITLE_NOT_ALLOWED: 'CHECKLIST_TITLE_NOT_ALLOWED',
  CHECKLIST_DAY_REQUIRED: 'CHECKLIST_DAY_REQUIRED',
  CHECKLIST_DAY_INVALID: 'CHECKLIST_DAY_INVALID',
  /** One day, one plan. Add the task to the existing one instead. */
  CHECKLIST_DAY_TAKEN: 'CHECKLIST_DAY_TAKEN',
  /** A checklist has to promise at least one thing. */
  CHECKLIST_EMPTY: 'CHECKLIST_EMPTY',
  CHECKLIST_TOO_MANY_TASKS: 'CHECKLIST_TOO_MANY_TASKS',
  CHECKLIST_DUE_INVALID: 'CHECKLIST_DUE_INVALID',

  // checklist task
  CHECKLIST_TASK_NOT_FOUND: 'CHECKLIST_TASK_NOT_FOUND',
  CHECKLIST_TASK_TITLE_REQUIRED: 'CHECKLIST_TASK_TITLE_REQUIRED',
  CHECKLIST_TASK_TITLE_TOO_LONG: 'CHECKLIST_TASK_TITLE_TOO_LONG',
  /** Sub-tasks are one level deep; a sub-task cannot own sub-tasks. */
  CHECKLIST_TASK_NESTING_TOO_DEEP: 'CHECKLIST_TASK_NESTING_TOO_DEEP',
  /** Dropped onto a task in another plan, another parent, or another group. */
  CHECKLIST_TASK_MOVE_INVALID: 'CHECKLIST_TASK_MOVE_INVALID',
  CHECKLIST_TASK_PRIORITY_MISMATCH: 'CHECKLIST_TASK_PRIORITY_MISMATCH',

  // asset
  ASSET_NOT_FOUND: 'ASSET_NOT_FOUND',
  ASSET_FILE_MISSING: 'ASSET_FILE_MISSING',
  ASSET_TOO_LARGE: 'ASSET_TOO_LARGE',
  ASSET_UNREADABLE: 'ASSET_UNREADABLE',
  ASSET_RENDER_FAILED: 'ASSET_RENDER_FAILED',
  ASSET_NAME_REQUIRED: 'ASSET_NAME_REQUIRED',
  /** The editor was pointed at something that is not Markdown or plain text. */
  ASSET_NOT_EDITABLE: 'ASSET_NOT_EDITABLE',

  // update
  /** The feed could not be reached, or answered with something unusable. */
  UPDATE_CHECK_FAILED: 'UPDATE_CHECK_FAILED',
  UPDATE_DOWNLOAD_FAILED: 'UPDATE_DOWNLOAD_FAILED',
  /** Asked to install when nothing has been downloaded. */
  UPDATE_NOT_READY: 'UPDATE_NOT_READY',
  /** This build cannot update itself — development, `--dir`, or portable. */
  UPDATE_UNSUPPORTED: 'UPDATE_UNSUPPORTED',

  // vault
  VAULT_UNWRITABLE: 'VAULT_UNWRITABLE',
  VAULT_PATH_ESCAPE: 'VAULT_PATH_ESCAPE',
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

/**
 * The only error type services are allowed to throw for expected failures.
 * Anything else escaping a service is a bug and is reported as UNKNOWN.
 */
export class AppError extends Error {
  readonly code: ErrorCode
  /** Optional machine-readable context, e.g. `{ limit: 104857600 }`. */
  readonly details: Record<string, unknown> | undefined

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.details = details
  }
}

/** Serialised form of an error once it has crossed IPC. */
export interface SerializedError {
  code: ErrorCode
  message: string
  details?: Record<string, unknown>
}
