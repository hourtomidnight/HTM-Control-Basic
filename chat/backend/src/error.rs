use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

#[derive(Debug)]
pub enum AppError {
    NotFound(&'static str),
    BadRequest(String),
    Unauthorized,
    Forbidden(&'static str),
    /// Server-side gating: user has an unconfirmed mandatory Attention Message.
    AttentionRequired(Vec<String>),
    Internal(anyhow::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message, extra) = match self {
            AppError::NotFound(what) => (StatusCode::NOT_FOUND, "not_found", what.to_string(), None),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, "bad_request", msg, None),
            AppError::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "authentication required".to_string(),
                None,
            ),
            AppError::Forbidden(msg) => (StatusCode::FORBIDDEN, "forbidden", msg.to_string(), None),
            AppError::AttentionRequired(ids) => (
                StatusCode::FORBIDDEN,
                "attention_required",
                "you must confirm pending attention message(s) before continuing".to_string(),
                Some(json!({ "attention_message_ids": ids })),
            ),
            AppError::Internal(err) => {
                tracing::error!(error = ?err, "internal error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal_error",
                    "internal server error".to_string(),
                    None,
                )
            }
        };

        let mut body = json!({ "error": code, "message": message });
        if let Some(extra) = extra {
            if let (Some(obj), Some(extra_obj)) = (body.as_object_mut(), extra.as_object()) {
                for (k, v) in extra_obj {
                    obj.insert(k.clone(), v.clone());
                }
            }
        }

        (status, Json(body)).into_response()
    }
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        match err {
            sqlx::Error::RowNotFound => AppError::NotFound("resource not found"),
            other => AppError::Internal(other.into()),
        }
    }
}

impl From<anyhow::Error> for AppError {
    fn from(err: anyhow::Error) -> Self {
        AppError::Internal(err)
    }
}

pub type AppResult<T> = Result<T, AppError>;
