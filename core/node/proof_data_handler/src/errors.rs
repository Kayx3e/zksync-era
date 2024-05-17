use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
};
use zksync_dal::SqlxError;
use zksync_object_store::ObjectStoreError;

pub(crate) enum RequestProcessorError {
    ObjectStore(ObjectStoreError),
    Sqlx(SqlxError),
}

impl IntoResponse for RequestProcessorError {
    fn into_response(self) -> Response {
        let (status_code, message) = match self {
            RequestProcessorError::ObjectStore(err) => {
                tracing::error!("GCS error: {:?}", err);
                (
                    StatusCode::BAD_GATEWAY,
                    "Failed fetching/saving from GCS".to_owned(),
                )
            }
            RequestProcessorError::Sqlx(err) => {
                tracing::error!("Sqlx error: {:?}", err);
                match err {
                    SqlxError::RowNotFound => {
                        (StatusCode::NOT_FOUND, "Non existing L1 batch".to_owned())
                    }
                    _ => (
                        StatusCode::BAD_GATEWAY,
                        "Failed fetching/saving from db".to_owned(),
                    ),
                }
            }
        };
        (status_code, message).into_response()
    }
}
