// 应用统一错误协议：引擎与命令层错误归一为 AppError，经 IPC 序列化为
// { code, message }，code 稳定不变，供前端程序化分支（与 Rust 版 error.rs 契约一致）。

export type AppErrorCode =
  | "io"
  | "invalid_package"
  | "source_not_quiet"
  | "hash_mismatch"
  | "plan_not_confirmed"
  | "path_setup"
  | "encoding_unsupported"
  | "internal";

const CODE_MESSAGES: Record<AppErrorCode, string> = {
  io: "IO 错误",
  invalid_package: "迁移包无效",
  source_not_quiet: "源程序未完全退出（检测到 SQLite WAL/SHM）",
  hash_mismatch: "哈希校验失败",
  plan_not_confirmed: "变更计划未确认或已失效",
  path_setup: "路径设置不合法",
  encoding_unsupported: "文本编码不受支持（需 UTF-8 无 BOM）",
  internal: "内部错误",
};

export class AppError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode, message: string) {
    super(`${CODE_MESSAGES[code]}：${message}`);
    this.name = "AppError";
    this.code = code;
  }

  /** IPC 序列化形态（与前端 AppErrorPayload 契约一致）。 */
  toJSON(): { code: AppErrorCode; message: string } {
    return { code: this.code, message: this.message };
  }
}

/** 把未知异常归一为 AppError（internal 兜底，保留原始消息）。 */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const message = e instanceof Error ? e.message : String(e);
  return new AppError("internal", message);
}
