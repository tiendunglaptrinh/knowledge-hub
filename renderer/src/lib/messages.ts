/**
 * Message catalogue — the only place user-facing text for an error lives.
 *
 * The main process returns `code`, never a sentence to display. The UI is
 * Vietnamese and the backend is English, so a message that crossed the wire
 * would either be the wrong language or freeze Vietnamese into the contract.
 * Adding an `ErrorCode` and adding its entry here happen in the same commit.
 *
 * See docs/05-ipc-contract.md#error-codes.
 */

import { ErrorCode } from '@shared/errors'

const MESSAGES: Record<string, string> = {
  [ErrorCode.UNKNOWN]: 'Đã xảy ra lỗi không mong muốn. Xem log ứng dụng để biết chi tiết.',
  [ErrorCode.VALIDATION_FAILED]: 'Dữ liệu nhập chưa hợp lệ.',

  [ErrorCode.CATEGORY_NOT_FOUND]: 'Không tìm thấy nhóm này.',
  [ErrorCode.CATEGORY_NAME_REQUIRED]: 'Vui lòng nhập tên nhóm.',
  [ErrorCode.CATEGORY_NAME_TOO_LONG]: 'Tên nhóm quá dài (tối đa 60 ký tự).',
  [ErrorCode.CATEGORY_NAME_DUPLICATE]: 'Tên nhóm này đã tồn tại.',
  [ErrorCode.CATEGORY_NOT_EMPTY]:
    'Nhóm vẫn còn tài liệu bên trong. Hãy chuyển hoặc xoá các tài liệu đó trước.',

  [ErrorCode.ITEM_NOT_FOUND]: 'Không tìm thấy tài liệu này.',
  [ErrorCode.ITEM_TITLE_REQUIRED]: 'Vui lòng nhập tiêu đề.',
  [ErrorCode.ITEM_TITLE_TOO_LONG]: 'Tiêu đề quá dài (tối đa 200 ký tự).',

  [ErrorCode.NOTE_NOT_FOUND]: 'Không tìm thấy ghi chú này.',
  [ErrorCode.NOTE_TITLE_REQUIRED]: 'Vui lòng nhập tiêu đề ghi chú.',
  [ErrorCode.NOTE_TITLE_TOO_LONG]: 'Tiêu đề ghi chú quá dài (tối đa 200 ký tự).',
  [ErrorCode.NOTE_DUE_INVALID]: 'Thời hạn không hợp lệ. Hãy chọn lại ngày giờ.',
  [ErrorCode.NOTE_DUE_REQUIRED]: 'Ghi chú loại “Hạn chót” cần có thời hạn cụ thể.',

  [ErrorCode.CHECKLIST_NOT_FOUND]: 'Không tìm thấy checklist này.',
  [ErrorCode.CHECKLIST_TITLE_REQUIRED]: 'Checklist module cần có tiêu đề.',
  [ErrorCode.CHECKLIST_TITLE_TOO_LONG]: 'Tiêu đề checklist quá dài (tối đa 200 ký tự).',
  [ErrorCode.CHECKLIST_TITLE_NOT_ALLOWED]:
    'Checklist ngày được đặt tên bằng chính ngày của nó, không có tiêu đề riêng.',
  [ErrorCode.CHECKLIST_DAY_REQUIRED]: 'Hãy chọn ngày cho checklist.',
  [ErrorCode.CHECKLIST_DAY_INVALID]: 'Ngày không hợp lệ. Hãy chọn lại.',
  [ErrorCode.CHECKLIST_DAY_TAKEN]:
    'Ngày này đã có checklist rồi. Hãy mở checklist của ngày đó và thêm việc vào.',
  [ErrorCode.CHECKLIST_EMPTY]:
    'Checklist phải có ít nhất một việc. Muốn bỏ hết thì hãy xoá cả checklist.',
  [ErrorCode.CHECKLIST_TOO_MANY_TASKS]: 'Một checklist chỉ chứa tối đa 500 việc.',
  [ErrorCode.CHECKLIST_DUE_INVALID]: 'Hạn chót không hợp lệ. Hãy chọn lại ngày giờ.',

  [ErrorCode.CHECKLIST_TASK_NOT_FOUND]: 'Không tìm thấy việc này.',
  [ErrorCode.CHECKLIST_TASK_TITLE_REQUIRED]: 'Vui lòng nhập tên việc.',
  [ErrorCode.CHECKLIST_TASK_TITLE_TOO_LONG]: 'Tên việc quá dài (tối đa 200 ký tự).',
  [ErrorCode.CHECKLIST_TASK_NESTING_TOO_DEEP]:
    'Việc nhỏ không thể chứa việc nhỏ khác. Nếu cần nhiều tầng, hãy dùng checklist module.',
  [ErrorCode.CHECKLIST_TASK_MOVE_INVALID]:
    'Chỉ đổi được thứ tự giữa các việc cùng cấp trong một checklist.',
  [ErrorCode.CHECKLIST_TASK_PRIORITY_MISMATCH]:
    'Không thể kéo việc lên trên một việc có độ ưu tiên cao hơn. Hãy đổi mức ưu tiên trước.',

  [ErrorCode.ASSET_NOT_FOUND]: 'Không tìm thấy tệp này.',
  [ErrorCode.ASSET_FILE_MISSING]:
    'Tệp có trong danh mục nhưng không còn trên ổ đĩa. Có thể nó đã bị xoá bên ngoài ứng dụng.',
  [ErrorCode.ASSET_TOO_LARGE]: 'Tệp vượt quá giới hạn 200 MB.',
  [ErrorCode.ASSET_UNREADABLE]: 'Không đọc được tệp này.',
  [ErrorCode.ASSET_RENDER_FAILED]:
    'Không hiển thị được nội dung tệp. Hãy thử mở bằng ứng dụng ngoài.',
  [ErrorCode.ASSET_NAME_REQUIRED]: 'Vui lòng nhập tên tài liệu.',
  [ErrorCode.ASSET_NOT_EDITABLE]:
    'Chỉ sửa được trực tiếp tệp Markdown và văn bản. Các định dạng khác hãy mở bằng ứng dụng ngoài.',

  [ErrorCode.UPDATE_CHECK_FAILED]:
    'Không kiểm tra được bản mới. Có thể máy đang mất mạng — thử lại sau.',
  [ErrorCode.UPDATE_DOWNLOAD_FAILED]:
    'Tải bản cập nhật không thành công. Bản đang dùng vẫn nguyên vẹn, hãy thử lại.',
  [ErrorCode.UPDATE_NOT_READY]: 'Chưa có bản cập nhật nào sẵn sàng để cài.',
  [ErrorCode.UPDATE_UNSUPPORTED]:
    'Bản này không tự cập nhật được. Chỉ bản cài đặt tải từ trang phát hành mới nhận cập nhật tự động.',

  [ErrorCode.VAULT_UNWRITABLE]:
    'Không ghi được vào thư mục lưu trữ. Kiểm tra KB_DATA_DIR trong tệp .env.',
  [ErrorCode.VAULT_PATH_ESCAPE]: 'Đường dẫn tệp không hợp lệ.',
  [ErrorCode.VAULT_TOO_NEW]:
    'Kho dữ liệu này thuộc về một phiên bản Knowledge Hub mới hơn. Hãy cài lại bản mới nhất rồi mở lại.',
}

export function messageFor(code: string): string {
  return MESSAGES[code] ?? MESSAGES[ErrorCode.UNKNOWN]!
}
