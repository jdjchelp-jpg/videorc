#[cfg(test)]
use anyhow::{Result, bail};

use crate::protocol::{
    EntitlementCapability, EntitlementSource, EntitlementState, EntitlementTier,
    EntitlementsSnapshot, FeatureId,
};

pub const PREMIUM_FEATURES_ENV_VAR: &str = "VIDEORC_PREMIUM_FEATURES";

const LIVESTREAMING_DISABLED_REASON: &str = "Livestreaming is a Videorc Premium feature. Set VIDEORC_PREMIUM_FEATURES=1 for local developer testing.";
const CLOUD_AI_DISABLED_REASON: &str = "Cloud AI is a Videorc Premium feature. Set VIDEORC_PREMIUM_FEATURES=1 for local developer testing.";
const DEVELOPER_OVERRIDE_REASON: &str = "Enabled by VIDEORC_PREMIUM_FEATURES=1.";

pub fn current_entitlements() -> EntitlementsSnapshot {
    let value = std::env::var(PREMIUM_FEATURES_ENV_VAR).ok();
    entitlements_from_env_value(value.as_deref())
}

pub fn entitlements_from_env_value(value: Option<&str>) -> EntitlementsSnapshot {
    if premium_override_enabled(value) {
        return EntitlementsSnapshot {
            tier: EntitlementTier::Developer,
            source: EntitlementSource::EnvOverride,
            capabilities: vec![
                EntitlementCapability {
                    feature_id: FeatureId::LocalRecording,
                    state: EntitlementState::Enabled,
                    reason: None,
                },
                EntitlementCapability {
                    feature_id: FeatureId::Livestreaming,
                    state: EntitlementState::DeveloperOverride,
                    reason: Some(DEVELOPER_OVERRIDE_REASON.to_string()),
                },
                EntitlementCapability {
                    feature_id: FeatureId::CloudAi,
                    state: EntitlementState::DeveloperOverride,
                    reason: Some(DEVELOPER_OVERRIDE_REASON.to_string()),
                },
            ],
        };
    }

    EntitlementsSnapshot {
        tier: EntitlementTier::Free,
        source: EntitlementSource::LocalDefault,
        capabilities: vec![
            EntitlementCapability {
                feature_id: FeatureId::LocalRecording,
                state: EntitlementState::Enabled,
                reason: None,
            },
            EntitlementCapability {
                feature_id: FeatureId::Livestreaming,
                state: EntitlementState::Disabled,
                reason: Some(LIVESTREAMING_DISABLED_REASON.to_string()),
            },
            EntitlementCapability {
                feature_id: FeatureId::CloudAi,
                state: EntitlementState::Disabled,
                reason: Some(CLOUD_AI_DISABLED_REASON.to_string()),
            },
        ],
    }
}

#[cfg(test)]
fn capability(
    snapshot: &EntitlementsSnapshot,
    feature_id: FeatureId,
) -> Option<&EntitlementCapability> {
    snapshot
        .capabilities
        .iter()
        .find(|capability| capability.feature_id == feature_id)
}

#[cfg(test)]
fn feature_entitled(snapshot: &EntitlementsSnapshot, feature_id: FeatureId) -> bool {
    capability(snapshot, feature_id)
        .map(|capability| capability.state != EntitlementState::Disabled)
        .unwrap_or(false)
}

#[cfg(test)]
fn require_feature(snapshot: &EntitlementsSnapshot, feature_id: FeatureId) -> Result<()> {
    let Some(capability) = capability(snapshot, feature_id) else {
        bail!("Feature entitlement is missing from the backend capability model.");
    };

    if capability.state == EntitlementState::Disabled {
        bail!(
            "{}",
            capability
                .reason
                .as_deref()
                .unwrap_or("This Videorc feature is not enabled.")
        );
    }

    Ok(())
}

fn premium_override_enabled(value: Option<&str>) -> bool {
    matches!(
        value.map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_ascii_lowercase()),
        Some(value)
            if matches!(
                value.as_str(),
                "1" | "true" | "yes" | "on" | "premium" | "developer" | "all"
            )
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn entitlement_default_snapshot_keeps_local_recording_free() {
        let snapshot = entitlements_from_env_value(None);

        assert_eq!(snapshot.tier, EntitlementTier::Free);
        assert_eq!(snapshot.source, EntitlementSource::LocalDefault);
        assert!(feature_entitled(&snapshot, FeatureId::LocalRecording));
        assert!(!feature_entitled(&snapshot, FeatureId::Livestreaming));
        assert!(!feature_entitled(&snapshot, FeatureId::CloudAi));
    }

    #[test]
    fn entitlement_env_override_enables_premium_features_for_development() {
        let snapshot = entitlements_from_env_value(Some("1"));

        assert_eq!(snapshot.tier, EntitlementTier::Developer);
        assert_eq!(snapshot.source, EntitlementSource::EnvOverride);
        assert!(feature_entitled(&snapshot, FeatureId::Livestreaming));
        assert!(feature_entitled(&snapshot, FeatureId::CloudAi));
        assert_eq!(
            capability(&snapshot, FeatureId::Livestreaming)
                .expect("livestreaming capability")
                .state,
            EntitlementState::DeveloperOverride
        );
    }

    #[test]
    fn entitlement_env_override_accepts_explicit_truthy_values_only() {
        assert!(feature_entitled(
            &entitlements_from_env_value(Some("developer")),
            FeatureId::CloudAi
        ));
        assert!(!feature_entitled(
            &entitlements_from_env_value(Some("0")),
            FeatureId::CloudAi
        ));
        assert!(!feature_entitled(
            &entitlements_from_env_value(Some("")),
            FeatureId::Livestreaming
        ));
    }

    #[test]
    fn entitlement_snapshot_uses_protocol_field_names() {
        let snapshot = entitlements_from_env_value(Some("true"));
        let value = serde_json::to_value(snapshot).unwrap();

        assert_eq!(value["tier"], json!("developer"));
        assert_eq!(value["source"], json!("env-override"));
        assert_eq!(
            value["capabilities"][0]["featureId"],
            json!("local-recording")
        );
        assert_eq!(
            value["capabilities"][1]["state"],
            json!("developer-override")
        );
    }

    #[test]
    fn entitlement_require_feature_returns_disabled_reason() {
        let snapshot = entitlements_from_env_value(None);
        let error = require_feature(&snapshot, FeatureId::Livestreaming)
            .expect_err("livestreaming should be gated in free mode");

        assert!(error.to_string().contains("Premium"));
    }
}
