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

import React, { lazy, Suspense } from "react";
// We import "matrix-js-sdk/src/rendezvous" asynchronously to avoid importing the entire Rust Crypto WASM into the main bundle.
import { RendezvousFailureReason } from "matrix-js-sdk/src/rendezvous/RendezvousFailureReason";
import { RendezvousIntent } from "matrix-js-sdk/src/rendezvous/RendezvousIntent";
import { logger } from "matrix-js-sdk/src/logger";
import { MatrixClient } from "matrix-js-sdk/src/matrix";

import type { MSC4108SignInWithQR } from "matrix-js-sdk/src/rendezvous";
import Spinner from "../elements/Spinner";

// We import `LoginWithQRFlow` asynchronously to avoid importing the entire Rust Crypto WASM into the main bundle.
const LoginWithQRFlow = lazy(() => import("./LoginWithQRFlow"));

/**
 * The intention of this enum is to have a mode that scans a QR code instead of generating one.
 */
export enum Mode {
    /**
     * A QR code with be generated and shown
     */
    Show = "show",
    // Scan = "scan",
}

export enum Phase {
    Loading,
    ShowingQR,
    Connecting,
    /**
     * @deprecated the MSC3906 implementation is deprecated in favour of MSC4108.
     */
    Connected,
    OutOfBandConfirmation,
    ShowChannelSecure,
    WaitingForDevice,
    Verifying,
    Continue,
    Error,
}

/**
 * @deprecated the MSC3906 implementation is deprecated in favour of MSC4108.
 */
export type LegacyPhase =
    | Phase.Loading
    | Phase.ShowingQR
    | Phase.Connecting
    | Phase.Connected
    | Phase.WaitingForDevice
    | Phase.Verifying
    | Phase.Error;

export enum Click {
    Cancel,
    Decline,
    Approve,
    TryAgain,
    Back,
    // ScanQr,
    ShowQr,
}

interface IProps {
    client?: MatrixClient;
    mode: Mode;
    onFinished(...args: any): void;
}

interface IState {
    phase: Phase;
    rendezvous?: MSC4108SignInWithQR;
    verificationUri?: string;
    userCode?: string;
    failureReason?: RendezvousFailureReason;
    mediaPermissionError?: boolean;
    lastScannedCode?: Buffer;
    ourIntent: RendezvousIntent;
    homeserverBaseUrl?: string;
}

/**
 * @deprecated the MSC3906 implementation is deprecated in favour of MSC4108.
 */
export enum LoginWithQRFailureReason {
    RateLimited = "rate_limited",
}

/**
 * @deprecated the MSC3906 implementation is deprecated in favour of MSC4108. See {@see RendezvousFailureReason}.
 */
export type FailureReason = RendezvousFailureReason | LoginWithQRFailureReason;

/**
 * A component that allows sign in and E2EE set up with a QR code.
 *
 * It implements `login.reciprocate` capabilities and showing QR codes.
 *
 * This uses the unstable feature of MSC3906: https://github.com/matrix-org/matrix-spec-proposals/pull/3906
 */
export default class LoginWithQR extends React.Component<IProps, IState> {
    public constructor(props: IProps) {
        super(props);

        this.state = {
            phase: Phase.Loading,
            ourIntent: this.props.client
                ? RendezvousIntent.RECIPROCATE_LOGIN_ON_EXISTING_DEVICE
                : RendezvousIntent.LOGIN_ON_NEW_DEVICE,
        };
    }

    public componentDidMount(): void {
        this.updateMode(this.props.mode).then(() => {});
    }

    public componentDidUpdate(prevProps: Readonly<IProps>): void {
        if (prevProps.mode !== this.props.mode) {
            this.updateMode(this.props.mode).then(() => {});
        }
    }

    private async updateMode(mode: Mode): Promise<void> {
        logger.info(`updateMode: ${mode}`);
        this.setState({ phase: Phase.Loading });
        if (this.state.rendezvous) {
            const rendezvous = this.state.rendezvous;
            rendezvous.onFailure = undefined;
            // await rendezvous.cancel(RendezvousFailureReason.UserCancelled);
            this.setState({ rendezvous: undefined });
        }
        if (mode === Mode.Show) {
            await this.generateAndShowCode();
        }
    }

    public componentWillUnmount(): void {
        if (this.state.rendezvous) {
            // eslint-disable-next-line react/no-direct-mutation-state
            this.state.rendezvous.onFailure = undefined;
            // calling cancel will call close() as well to clean up the resources
            this.state.rendezvous.cancel(RendezvousFailureReason.UserCancelled).then(() => {});
        }
    }

    private generateAndShowCode = async (): Promise<void> => {
        let rendezvous: MSC4108SignInWithQR;
        try {
            const Rendezvous = await import("matrix-js-sdk/src/rendezvous");

            const fallbackRzServer =
                this.props.client?.getClientWellKnown()?.["io.element.rendezvous"]?.server ??
                "https://rendezvous.lab.element.dev";
            const transport = new Rendezvous.MSC4108RendezvousSession({
                onFailure: this.onFailure,
                client: this.props.client,
                fallbackRzServer,
            });
            await transport.send("");

            const channel = new Rendezvous.MSC4108SecureChannel(transport, undefined, this.onFailure);

            rendezvous = new Rendezvous.MSC4108SignInWithQR(channel, false, this.props.client, this.onFailure);

            await rendezvous.generateCode();
            this.setState({
                phase: Phase.ShowingQR,
                rendezvous,
                failureReason: undefined,
            });
        } catch (e) {
            logger.error("Error whilst generating QR code", e);
            this.setState({ phase: Phase.Error, failureReason: RendezvousFailureReason.HomeserverLacksSupport });
            return;
        }

        try {
            if (this.state.ourIntent === RendezvousIntent.LOGIN_ON_NEW_DEVICE) {
                // MSC4108-Flow: ExistingScanned

                // we get the homserver URL from the secure channel, but we don't trust it yet
                const { homeserverBaseUrl } = await rendezvous.loginStep1();

                if (!homeserverBaseUrl) {
                    throw new Error("We don't know the homeserver");
                }
                this.setState({
                    phase: Phase.OutOfBandConfirmation,
                    homeserverBaseUrl,
                });
            } else {
                // MSC4108-Flow: NewScanned
                await rendezvous.loginStep1();
                const { verificationUri } = await rendezvous.loginStep2And3();
                this.setState({
                    phase: Phase.OutOfBandConfirmation,
                    verificationUri,
                });
            }

            // we ask the user to confirm that the channel is secure
        } catch (e) {
            logger.error("Error whilst doing QR login", e);
            // only set to error phase if it hasn't already been set by onFailure or similar
            if (this.state.phase !== Phase.Error) {
                this.setState({ phase: Phase.Error, failureReason: RendezvousFailureReason.Unknown });
            }
        }
    };

    private approveLoginAfterShowingCode = async (): Promise<void> => {
        if (!this.state.rendezvous) {
            throw new Error("Rendezvous not found");
        }

        if (this.state.ourIntent === RendezvousIntent.RECIPROCATE_LOGIN_ON_EXISTING_DEVICE) {
            // MSC4108-Flow: NewScanned
            this.setState({ phase: Phase.Loading });

            if (this.state.verificationUri) {
                window.open(this.state.verificationUri, "_blank");
            }

            this.setState({ phase: Phase.WaitingForDevice });

            // send secrets
            await this.state.rendezvous.loginStep5();

            // done
            this.props.onFinished(true);
        } else {
            throw new Error("New device flows around OIDC are not yet implemented");
        }
    };

    private onFailure = (reason: RendezvousFailureReason): void => {
        logger.info(`Rendezvous failed: ${reason}`);
        this.setState({ phase: Phase.Error, failureReason: reason });
    };

    public reset(): void {
        this.setState({
            rendezvous: undefined,
            verificationUri: undefined,
            failureReason: undefined,
            userCode: undefined,
            homeserverBaseUrl: undefined,
            lastScannedCode: undefined,
            mediaPermissionError: false,
        });
    }

    private onClick = async (type: Click): Promise<void> => {
        switch (type) {
            case Click.Cancel:
                await this.state.rendezvous?.cancel(RendezvousFailureReason.UserCancelled);
                this.reset();
                this.props.onFinished(false);
                break;
            case Click.Approve:
                await this.approveLoginAfterShowingCode();
                break;
            case Click.Decline:
                await this.state.rendezvous?.declineLoginOnExistingDevice();
                this.reset();
                this.props.onFinished(false);
                break;
            case Click.TryAgain:
                this.reset();
                await this.updateMode(this.props.mode);
                break;
            case Click.Back:
                await this.state.rendezvous?.cancel(RendezvousFailureReason.UserCancelled);
                this.props.onFinished(false);
                break;
            case Click.ShowQr:
                await this.updateMode(Mode.Show);
                break;
        }
    };

    public render(): React.ReactNode {
        logger.info("LoginWithQR render");
        return (
            <Suspense fallback={<Spinner />}>
                <LoginWithQRFlow
                    onClick={this.onClick}
                    phase={this.state.phase}
                    code={this.state.phase === Phase.ShowingQR ? this.state.rendezvous?.code : undefined}
                    failureReason={this.state.phase === Phase.Error ? this.state.failureReason : undefined}
                    userCode={this.state.userCode}
                />
            </Suspense>
        );
    }
}
