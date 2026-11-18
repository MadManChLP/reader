use serde::{Deserialize, Serialize};

/// System media volume, normalized to 0..1.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeResponse {
    pub volume: f32,
}

/// Screen brightness, normalized to 0..1.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrightnessResponse {
    pub brightness: f32,
}
