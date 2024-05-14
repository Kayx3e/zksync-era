use anyhow::Context;
use zksync_config::configs;
use zksync_protobuf::{required, ProtoRepr};

use crate::proto::{da_dispatcher as proto, object_store::ObjectStore};

impl ProtoRepr for proto::DataAvailabilityDispatcher {
    type Type = configs::da_dispatcher::DADispatcherConfig;

    fn read(&self) -> anyhow::Result<Self::Type> {
        configs::da_dispatcher::DADispatcherConfig {
            mode: match &self.credentials {
                Some(proto::data_availability_dispatcher::Credentials::DaLayer(config)) => {
                    configs::da_dispatcher::DataAvailabilityMode::DALayer(
                        configs::da_dispatcher::DALayerInfo {
                            name: *required(&config.name).context("name"),
                            private_key: required(&config.private_key)
                                .context("private_key")
                                .into_bytes(),
                        },
                    )
                }
                Some(proto::data_availability_dispatcher::Credentials::ObjectStore(config)) => {
                    configs::da_dispatcher::DataAvailabilityMode::GCS(config.read()?)
                }
                None => configs::da_dispatcher::DataAvailabilityMode::NoDA,
            },
        }
    }

    fn build(this: &Self::Type) -> Self {
        let credentials = match this.mode.clone() {
            configs::da_dispatcher::DataAvailabilityMode::DALayer(info) => Some(
                proto::data_availability_dispatcher::Credentials::DaLayer(proto::DaLayer {
                    name: Some(info.name.clone()),
                    private_key: info.private_key.clone().into(),
                }),
            ),
            configs::da_dispatcher::DataAvailabilityMode::GCS(config) => Some(
                proto::data_availability_dispatcher::Credentials::ObjectStore(ObjectStore::build(
                    &config,
                )),
            ),
            configs::da_dispatcher::DataAvailabilityMode::NoDA => None,
        };

        Self { credentials }
    }
}
