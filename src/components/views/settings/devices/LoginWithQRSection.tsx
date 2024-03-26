/*
Copyright 2022 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import React from "react";
import {
    IGetLoginTokenCapability,
    IServerVersions,
    GET_LOGIN_TOKEN_CAPABILITY,
    Capabilities,
    IClientWellKnown,
    OidcClientConfig,
} from "matrix-js-sdk/src/matrix";
import { Icon as QrCodeIcon } from "@vector-im/compound-design-tokens/icons/qr-code.svg";
import { logger } from "matrix-js-sdk/src/logger";

import { _t } from "../../../../languageHandler";
import AccessibleButton from "../../elements/AccessibleButton";
import SettingsSubsection from "../shared/SettingsSubsection";

interface IProps {
    onShowQr: () => void;
    versions?: IServerVersions;
    capabilities?: Capabilities;
    wellKnown?: IClientWellKnown;
    oidcClientConfig?: OidcClientConfig;
}

export default class LoginWithQRSection extends React.Component<IProps> {
    public constructor(props: IProps) {
        super(props);
    }

    public render(): JSX.Element | null {
        // Needs server support for (get_login_token or OIDC Device Authorization Grant) and MSC3886:
        // in r0 of MSC3882 it is exposed as a feature flag, but in stable and unstable r1 it is a capability
        const loginTokenCapability = GET_LOGIN_TOKEN_CAPABILITY.findIn<IGetLoginTokenCapability>(
            this.props.capabilities,
        );
        const getLoginTokenSupported =
            !!this.props.versions?.unstable_features?.["org.matrix.msc3882"] || !!loginTokenCapability?.enabled;
        const msc3886Supported =
            !!this.props.versions?.unstable_features?.["org.matrix.msc3886"] ||
            !!this.props.wellKnown?.["io.element.rendezvous"]?.server;
        const msc4108Supported =
            !!this.props.versions?.unstable_features?.["org.matrix.msc4108"] ||
            !!this.props.wellKnown?.["io.element.rendezvous"]?.server;

        const deviceAuthorizationGrantSupported = this.props.oidcClientConfig?.metadata?.grant_types_supported.includes(
            "urn:ietf:params:oauth:grant-type:device_code",
        );

        logger.debug({
            msc3886Supported,
            getLoginTokenSupported,
            msc4108Supported,
            deviceAuthorizationGrantSupported,
        });
        const offerShowQr = this.props.oidcClientConfig
            ? deviceAuthorizationGrantSupported && msc4108Supported
            : getLoginTokenSupported && msc3886Supported;

        // don't show anything if no method is available
        if (!offerShowQr) {
            return null;
        }

        return (
            <SettingsSubsection heading={_t("settings|sessions|sign_in_with_qr")}>
                <div className="mx_LoginWithQRSection">
                    <p className="mx_SettingsTab_subsectionText">
                        {_t("settings|sessions|sign_in_with_qr_description")}
                    </p>
                    <AccessibleButton onClick={this.props.onShowQr} kind="primary">
                        <QrCodeIcon height={20} width={20} />
                        {_t("settings|sessions|sign_in_with_qr_button")}
                    </AccessibleButton>
                </div>
            </SettingsSubsection>
        );
    }
}
