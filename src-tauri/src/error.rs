//! 统一错误协议：所有 Tauri command 返回 `Result<T, AppError>`。
//! 序列化为 `{ code, message }`，前端按 code 分类选择消息通道。

use serde::ser::SerializeStruct;

/// 应用统一错误类型。`code` 稳定不变，供前端程序化分支。
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// 文件系统 IO 错误（读写、复制、删除）。
    #[error("IO 错误：{0}")]
    Io(#[from] std::io::Error),

    /// 迁移包缺失、损坏、清单不合法或格式版本不受支持。
    #[error("迁移包无效：{0}")]
    InvalidPackage(String),

    /// 源程序可能未完全退出（检测到 SQLite `-wal`/`-shm` 文件）。
    #[error("源程序未完全退出（检测到 SQLite WAL/SHM）：{0}")]
    SourceNotQuiet(String),

    /// 打包或解包后逐文件哈希复验失败。
    #[error("哈希校验失败：{0}")]
    HashMismatch(String),

    /// dry-run 变更计划未确认、令牌失效或与执行参数不符。
    #[error("变更计划未确认或已失效：{0}")]
    PlanNotConfirmed(String),

    /// 用户提供的路径不合法（不存在、指向源目录自身等）。
    #[error("路径设置不合法：{0}")]
    PathSetup(String),

    /// 文本资产编码不受支持（仅支持 UTF-8 无 BOM）。
    #[error("文本编码不受支持（需 UTF-8 无 BOM）：{0}")]
    EncodingUnsupported(String),

    /// 引擎内部不变量被破坏，属于缺陷而非用户错误。
    #[error("内部错误：{0}")]
    Internal(String),
}

impl AppError {
    /// 错误码（稳定契约，前端依赖）。
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Io(_) => "io",
            AppError::InvalidPackage(_) => "invalid_package",
            AppError::SourceNotQuiet(_) => "source_not_quiet",
            AppError::HashMismatch(_) => "hash_mismatch",
            AppError::PlanNotConfirmed(_) => "plan_not_confirmed",
            AppError::PathSetup(_) => "path_setup",
            AppError::EncodingUnsupported(_) => "encoding_unsupported",
            AppError::Internal(_) => "internal",
        }
    }
}

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

/// 全局结果别名。
pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    /// 错误序列化为 { code, message }，code 稳定。
    #[test]
    fn error_apperror_serialize_code_message() {
        let err = AppError::SourceNotQuiet("db.sqlite".into());
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["code"], "source_not_quiet");
        assert!(json["message"].as_str().unwrap().contains("WAL"));
    }
}
