use axum::{
    Router,
    extract::{Multipart, State},
    http::StatusCode,
    routing::post,
};
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::utils::relate_to_data_path;

/// 上传目录（相对用户数据目录 data/）
const UPLOAD_DIR: &str = "uploads";
/// 可通过 URL 访问的静态前缀
const UPLOAD_URL_PREFIX: &str = "/uploads";

#[derive(Clone)]
pub struct AppStateUpload {
    // 预留：未来可存放 token 校验等状态
    _inner: Arc<Mutex<()>>,
}

pub fn routers() -> Router {
    Router::new().route("/upload", post(upload_file)).with_state(AppStateUpload {
        _inner: Arc::new(Mutex::new(())),
    })
}

/// 处理 multipart 文件上传，保存到 uploads/ 目录，返回可访问 URL。
async fn upload_file(
    State(_state): State<AppStateUpload>,
    mut multipart: Multipart,
) -> Result<axum::Json<serde_json::Value>, (StatusCode, String)> {
    let save_dir = relate_to_data_path([UPLOAD_DIR]);
    std::fs::create_dir_all(&save_dir)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("mkdir failed: {e}")))?;

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);

    // 取第一个上传的图片字段
    let mut saved_path: Option<String> = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, format!("multipart error: {e}")))?
    {
        let file_name = field
            .file_name()
            .map(|s| s.to_string())
            .unwrap_or_else(|| "upload.png".to_string());
        let ext = file_name
            .rsplit('.')
            .next()
            .filter(|e| *e != file_name) // 确保有点
            .map(|e| e.to_lowercase())
            .unwrap_or_else(|| "png".to_string());
        // 只允许图片扩展名
        if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "bmp") {
            continue;
        }

        let data = field
            .bytes()
            .await
            .map_err(|e| (StatusCode::BAD_REQUEST, format!("read field failed: {e}")))?;

        let filename = format!("upload-{ts}.{ext}");
        let full_path = save_dir.join(&filename);
        std::fs::write(&full_path, &data).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("write failed: {e}"),
            )
        })?;
        saved_path = Some(format!("{UPLOAD_URL_PREFIX}/{filename}"));
        break; // 只处理第一个有效图片
    }

    match saved_path {
        Some(url) => Ok(axum::Json(serde_json::json!({
            "code": 0,
            "data": { "url": url }
        }))),
        None => Err((StatusCode::BAD_REQUEST, "no valid image uploaded".to_string())),
    }
}
