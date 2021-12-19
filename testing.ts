/*
 * ////////////////////////////////////////////////////////////////////////////////
 * //
 * // This software system consists of computer software and documentation.
 * // It contains trade secrets and confidential information which are proprietary
 * // to Everi Games Inc.  Its use or disclosure in whole or in part without
 * // the express written permission of Everi Games Inc. is prohibited.
 * //
 * // This software system is also an unpublished work protected under the copyright
 * // laws of the United States of America.
 * //
 * // Copyright © 2018 Everi Games Inc.  All Rights Reserved
 * //
 * ////////////////////////////////////////////////////////////////////////////////
 */
import { CultureID } from '../Localization/CultureID';
import LocalizationComponent from '../Localization/LocalizationComponent';
import Communicator from '../Server/Communicator';
import IPlayResultData from '../Server/Object/IPlayResultData';
import { IPlatformBetOption, IPlayState } from '../Server/Object/PlayResult';
import { PlayResultData } from '../Server/PlayResultData';
import ServerSettings from '../Server/ServerSettings';
import {
    IAutoPlayConfig,
    IBetConfig,
    IDefaultBet,
    IDenomConfig,
    IDisplayOptions,
    IRecallOptions,
    ISettings,
    ISetupResult,
} from '../Server/SetupResult';
import StateDependencyComponent from '../StateManager/StateDependencyComponent';
import StateEvent from '../StateManager/StateEvent';
import { StateID } from '../StateManager/StateID';
import StateReference from '../StateManager/StateReference';
import InjectableComponent from '../Utility/Component/ComponentReference/InjectableComponent';
import ObservableStringComponent from '../Utility/Component/Observable/ObservableStringComponent';
import CLog, { LogTypes } from '../Utility/ComponentLogger';
import Decorators from '../Utility/Decorators';
import { extractErrorMessage, isNullOrEmpty, withValue } from '../Utility/Misc';
import IObservable from '../Utility/Observable/IObservable';
import TypeStrings from '../Utility/TypeStrings';
import UriBuilder from '../Utility/UriBuilder';
import { DisplayKey } from './DisplayKey';
import { ISGDLaunchDetails } from './Integrations/NyxInterfaces';

// tslint:disable-next-line:max-line-length
/** @hidden */
// tslint:disable-next-line:typedef
const ccclass = cc._decorator.ccclass;
/** @hidden */
// tslint:disable-next-line:typedef
const property = cc._decorator.property;

/** Configuration data supplied by the game host. */
export interface IClientConfig
{
    gameId: string;
    platformId: string;
    serverHost: string;
    serverPort: number;
    rgsVersion: string;
    operatorId: string | null;
    gameType: string;
    clientType: string | null;
    locale: string | null;
    currencyCode: string | null;
    userId: string;
    userToken: string;
    use12HourClock: boolean;
    version: string;
    recall?: number;
    jurisdiction: string;
    lobbyUrl?: string;
    rgsUser?: string;
    rgsSession?: string;
    platformRecallRoundId: string;
    lauchDetails?: { sgd?: ISGDLaunchDetails; };
    clientconfig: ISubClientConfig;
}

interface ISubClientConfig
{
    client?: { servicePath?: string };
}

// #region Enums

export enum AutoSpinType
{
    None,
    Standard,
    Extended
}

export enum ClientType
{
    Desktop,
    Mobile
}

export enum GameType
{
    Social,
    Wager
}

export enum WagerDisplay
{
    Cash,
    Credits,
    Toggle
}

// #endregion

// #region Editor Data Classes

/**
 * For editor/development only.
 * @hidden
 */
@ccclass("AutoPlayConfig")
export class AutoPlayConfig implements IAutoPlayConfig
{
    @property()
    public type: string = "standard";
    @property({ type: [cc.Integer] })
    public options: number[] = [10, 25, 50, 100, 200];
    @property()
    public max: number = 200;
}

/**
 * For editor/development only.
 * @hidden
 */
@ccclass("RecallOptions")
export class RecallOptions implements IRecallOptions
{
    @property()
    public enabled: boolean = true;
    @property({ type: cc.Integer })
    public history: number = 10;
}

/**
 * For editor/development only.
 * @hidden
 */
@ccclass("DisplayOptions")
export class DisplayOptions implements IDisplayOptions
{
    // tslint:disable-next-line:typedef
    public static readonly AutoSpinOption = cc.Enum(AutoSpinType);

    @property({ type: AutoPlayConfig })
    public autoSpin: AutoPlayConfig = new AutoPlayConfig();
    @property()
    public balance: boolean = false;
    @property()
    public bet: boolean = false;
    @property()
    public gameName: boolean = false;
    @property()
    public help: boolean = false;
    @property()
    public language: boolean = false;
    @property()
    public lobby: boolean = false;
    @property()
    public lobbyExclusion: string = "";
    @property({ type: RecallOptions })
    public recall: RecallOptions = new RecallOptions();
    @property()
    public rtp: boolean = false;
    @property()
    public serverTime: boolean = false;
    @property()
    public sessionTime: boolean = false;
    @property()
    public settings: boolean = false;
    @property()
    public sound: boolean = false;
    @property()
    public turbo: boolean = false;
}

/**
 * For editor/development only.
 * @hidden
 */
@ccclass("ClientDefaults")
export class ClientDefaults implements IClientConfig
{
    @property()
    public gameId: string = "";
    @property()
    public platformId: string = "";
    @property()
    public serverHost: string = "";
    @property()
    public serverPort: number  = 8080;
    @property()
    public rgsVersion: string = "1.0.0";
    @property()
    public operatorId: string = "operator_everi";
    @property()
    public jurisdiction: string = "everi";
    @property()
    public gameType: string = "wager";
    @property()
    public clientType: string = "mobile";
    @property()
    public locale: string = "en_US";
    @property()
    public currencyCode: string = "USD";
    @property()
    public use12HourClock: boolean = true;
    @property()
    public userId: string = "";
    @property()
    public userToken: string = "";
    @property()
    public version: string = "0.0.0";
    @property({ type: DisplayOptions, visible: true })
    public displayOptions: DisplayOptions = new DisplayOptions();
    @property({ visible: false })
    public platformRecallRoundId: string = null;
    public clientconfig: any = null;
}

// #endregion

/**
 * GameSetup contains all of the configuration data for a game and should
 * be considered the single source of truth for the included options.
 */
@ccclass
export default class GameSetup extends StateDependencyComponent
{
    /**
     * The game state on which GameSetup should request configuration data
     * from the RGS server.
     */
    @property({ type: StateReference, visible: true })
    private _setupOnState: StateReference = new StateReference(StateID.Initializing, true);
    public get SetupOnState(): StateReference { return this._setupOnState; }

    @property(ObservableStringComponent)
    protected versionObservable: IObservable<string> = null;

    @property(ObservableStringComponent)
    protected rtpDisplayObservable: IObservable<string> = null;

    @property(ObservableStringComponent)
    protected autoCompleteObservable: IObservable<string> = null;

    /**
     * For development/editor only.
     * @hidden
     */
    @property({ type: ClientDefaults, visible: true })
    private _clientDefaults: ClientDefaults = new ClientDefaults();
    public get ClientDefaults(): ClientDefaults { return this._clientDefaults; }

    /** @hidden */
    private _communicatorRef: InjectableComponent<Communicator> = new InjectableComponent();
    /** @hidden */
    private _localRef: InjectableComponent<LocalizationComponent> = new InjectableComponent();

    /** The supplied client clonfiguration. */
    private _clientConfig: IClientConfig = null;
    /** The configuration data returned from the RGS server. */
    private _rgsConfig: ISetupResult = null;
    /** The key used to load the client config from the window's javascript context. */
    private static readonly CONFIG_KEY: string = "clientConfig";

    /** Handlers to run after setup received and [[GameSetup]] work complete. */
    private _onSetupCompleteHandlers: (() => void)[] = [];

    // #region cc.Component Lifecycle

    /** @hidden */
    protected setContexts(): void
    {
        super.setContexts();
        this._communicatorRef.SetContext(Communicator);
        this._localRef.SetContext(LocalizationComponent);
    }

    /**
     * Cocos Creator lifecycle method called on creation.
     * @hidden
     */
    protected onLoad(): void
    {
        super.onLoad();

        this._clientConfig = window[GameSetup.CONFIG_KEY];

        if (!this._clientConfig)
        {
            this._clientConfig = this._clientDefaults;
            if (!CC_DEBUG) { CLog.error("No client config present.", this, LogTypes.Initialization); }
        }

        this.updateObservables();
    }

    /** @hidden */
    protected start(): void
    {
        super.start(this._setupOnState);
    }

    /**
     * Handler for game state change.
     * @param event - The StateEvent representing the new state.
     * @hidden
     */
    protected onStateChangeHandler = (event: StateEvent): void =>
    {
        if (event.State === this._setupOnState.Value)
        {
            this.requestSetup();
        }
    }

    private requestSetup(): void
    {
        this._communicatorRef.WithValue(communicator =>
        {
            if (this.Recall === true || this.PlatformRecallRoundID != null)
            {
                communicator.RequestRecallSetup(this.setupReceivedHandler);
            }
            else
            {
                communicator.RequestSetup(this.setupReceivedHandler);
            }
        });
    }

    /**
     * Attach handler to setup received.
     * @param handler Function to attach.
     */
    public OnSetupReceived(handler: () => void): void
    {
        this._onSetupCompleteHandlers.push(handler);
    }

    public OffSetupReceived(handler: Function): void
    {
        this._onSetupCompleteHandlers = this._onSetupCompleteHandlers.filter(setupHandler => setupHandler === handler);
    }

    /**
     * Handler for configuration data response from the RGS server.
     * @param result - The raw JSON string of configuration data.
     * @hidden
     */
    @Decorators.BindThis()
    private setupReceivedHandler = (result: ISetupResult): void =>
    {
        if (!result) { return; }
        this._rgsConfig = result;
        this.parsePlatformBetOptions(result);

        if (!this._rgsConfig || !this._rgsConfig.denomConfigs)
        {
            CLog.error("Invalid setup data, cannot proceed.", this, LogTypes.Communicator);
            return;
        }

        if (!this._rgsConfig.settings || !this._rgsConfig.settings.uiDisplayOptions)
        {
            this._rgsConfig.settings.uiDisplayOptions = this._clientDefaults.displayOptions;
        }

        this._onSetupCompleteHandlers.forEach(handler => handler());
        this._localRef.WithValue(local => local.OnChanged(this.updateObservables.bind(this)));

        this.updateObservables();
        CLog.Debug = this.IsPrizeForceEnabled;
        this.completeState(this._setupOnState.Value);
    }

    private parsePlatformBetOptions(setupResult: ISetupResult): void
    {
        withValue(setupResult.platformBetOption as string, option =>
        {
            if (typeof(option) !== TypeStrings.string) { return; }

            try
            {
                setupResult.platformBetOption = JSON.parse(option);
            }
            catch (e)
            {
                CLog.error(`Error parsing bet scalars, string: [${option}] => error: [${extractErrorMessage(e)}]`);
            }
        },
        () =>
        {
            withValue(this.LastPlayState, state => setupResult.platformBetOption = state.platformBetOption);
        });
    }

    private updateObservables(): void
    {
        if (this.versionObservable) { this.versionObservable.Value = this.Version; }

        if (this.autoCompleteObservable
            && this._rgsConfig
            && this._rgsConfig.settings
            && this._rgsConfig.settings.juris)
        {
            let freq: number = this._rgsConfig.settings.juris.autoCompleteDayFreq;
            let max: number = this._rgsConfig.settings.juris.autoCompleteDayMax;

            if (freq === max)
            {
                this.autoCompleteObservable.Value = max.toString();
            }
            else
            {
                this.autoCompleteObservable.Value = `${(freq * 24)} - ${(max * 24)}`;
            }
        }

        if (this.rtpDisplayObservable && this.DenomConfigs)
        {
            let low: number = null;
            let high: number = null;
            let first: boolean = true;

            for (let denomConfigKey in this.DenomConfigs)
            {
                let denomConfig: IDenomConfig = this.DenomConfigs[denomConfigKey];

                if (!denomConfig.rtp) { continue; }

                let rtps: number[] = denomConfig.rtp.slice(0).sort((a, b) => a - b);

                let newLow: number = rtps[0];
                let newHigh: number = rtps[rtps.length - 1];

                if (first)
                {
                    low = newLow;
                    high = newHigh;

                    first = false;
                    continue;
                }

                if (newLow < low) { low = newLow; }
                if (newHigh > high) { high = newHigh; }
            }

            if (low) { low = low / 100; }
            if (high) { high = high / 100; }

            if (low === undefined || low === null)
            {
                this.rtpDisplayObservable.Value = '';
                CLog.log('No RTP configured for game.', LogTypes.Game, this);
                return;
            }

            this._localRef.WithValue((local) =>
            {
                this.rtpDisplayObservable.Value = low !== high
                    ? local.GetStringResource("HelpScreen/RTPRange", `${low.toFixed(2)}%`, `${high.toFixed(2)}%`)
                    : local.GetStringResource("HelpScreen/RTP", `${low.toFixed(2)}%`);
            },
            () => // Default
            {
                this.rtpDisplayObservable.Value = low !== high
                    ? `RTP ${low.toFixed(2)}% - ${high.toFixed(2)}%`
                    : `RTP ${low.toFixed(2)}%`;
            });
        }
    }

    // #endregion

    // #region Game Portal Config Properties

    /**
     * Whether or not this game should be configured for mobile or desktop play.
     */
    public get Client(): ClientType
    {
        if (this._clientConfig && this._clientConfig.clientType.toLowerCase() === "desktop")
        {
            return ClientType.Desktop;
        }

        return ClientType.Mobile;
    }

    /**
     * The currency code to be used for formatting cash displays.
     */
    public get CurrencyCode(): string
    {
        if (this._clientConfig && this._clientConfig.currencyCode)
        {
            return this._clientConfig.currencyCode;
        }

        return "USD";
    }

    /**
     * The ID to use to identify the game to the RGS server.
     */
    public get GameID(): string
    {
        if (this._clientConfig)
        {
            return this._clientConfig.gameId;
        }

        return null;
    }

    /**
     * Whether or not this game should be configured for social or for wager gaming.
     */
    public get GameStyle(): GameType
    {
        if (this._clientConfig && this._clientConfig.gameType.toLowerCase() === "wager")
        {
            return GameType.Wager;
        }

        return GameType.Social;
    }

    /**
     * The jurisdiction being operated in.
     */
    public get Jurisdiction(): string
    {
        return this._clientConfig.jurisdiction;
    }

    /**
     * IETF locale code to use for localization.
     */
    public get Locale(): CultureID
    {
        if (this._clientConfig && this._clientConfig.locale)
        {
            const cultureString: string = this._clientConfig.locale.toLowerCase().replace("-", "_");
            const culture: CultureID = CultureID[cultureString];
            if (culture)
            {
                return culture;
            }
        }

        return CultureID.en_us;
    }

    /**
     * The ID to use to identify the operator to the RGS server.
     */
    public get OperatorID(): string
    {
        if (this._clientConfig && this._clientConfig.operatorId)
        {
            return this._clientConfig.operatorId;
        }

        return null;
    }

    /**
     * The ID to use to identify the platform to the RGS server.
     */
    public get PlatformID(): string
    {
        if (this._clientConfig)
        {
            return this._clientConfig.platformId;
        }

        return null;
    }

    /**
     * The play ID to be used for recall.
     */
    public get PlayID(): number
    {
        if (this._clientConfig && this._clientConfig.recall)
        {
            return this._clientConfig.recall;
        }
    }

    /**
     * Whether or not this game should initiate a Recall on start.
     */
    public get Recall(): boolean
    {
        if (this._clientConfig)
        {
            return (this._clientConfig.recall != undefined);
        }

        return false;
    }

    /**
     * The port to use to connect to the RGS server.
     */
    public get RGSPort(): number
    {
        if (this._clientConfig)
        {
            return this._clientConfig.serverPort;
        }

        return 8080;
    }

    /**
     * The hostname to use to connect to the RGS server.
     */
    public get RGSServer(): string
    {
        if (!this._clientConfig) { return null; }

        const clientconfig: ISubClientConfig = this._clientConfig.clientconfig;
        return clientconfig && clientconfig.client && clientconfig.client.servicePath
                ? this._clientConfig.serverHost + clientconfig.client.servicePath
                : this._clientConfig.serverHost;
    }

    /**
     * Convenience method to return a ServerSettings object for connecting to the RGS server.
     */
    public get RGSServerSettings(): ServerSettings
    {
        return new ServerSettings(this.RGSServer, this.RGSPort, this.GameID);
    }

    /**
     * Version of the RGS server we are hitting.
     */
    public get RGSVersion(): string
    {
        return this._clientConfig.rgsVersion;
    }

    /**
     * Should the server time display use a 12 or 24 hour clock.
     */
    public get Use12HourClock(): boolean
    {
        if (this._rgsConfig)
        {
            const settings: ISettings = this._rgsConfig.settings;
            if (settings && settings.use12HourClock != null)
            {
                return settings.use12HourClock;
            }
        }
        if (this._clientConfig) { return this._clientConfig.use12HourClock; }
        return true;
    }

    /**
     * The ID of the current user.
     */
    public get UserID(): string
    {
        if (this._clientConfig)
        {
            return this._clientConfig.userId;
        }

        return null;
    }

    /**
     * The current user's access token.
     */
    public get UserToken(): string
    {
        if (this._clientConfig)
        {
            return this._clientConfig.userToken;
        }

        return null;
    }

    /**
     * The admin user
     */
    public get RGSUser(): string
    {
        if (this._clientConfig)
        {
            return this._clientConfig.rgsUser;
        }

        return null;
    }

    /**
     * The admin token
     */
    public get RGSSession(): string
    {
        if (this._clientConfig)
        {
            return this._clientConfig.rgsSession;
        }

        return null;
    }

    /**
     * The client version.
     */
    public get Version(): string
    {
        if (this._clientConfig)
        {
            return this._clientConfig.version;
        }

        return null;
    }

    public get PlatformRecallRoundID(): string
    {
        if (this._clientConfig)
        {
            return this._clientConfig.platformRecallRoundId;
        }

        return null;
    }

    // #endregion

    // #region RGS Client Config Properties

    /**
     * The active denom to be set at game launch.
     */
    public get ActiveDenom(): number
    {
        return this._rgsConfig ? this._rgsConfig.activeDenom : null;
    }

    /**
     * The type of autospin menu to use. None, Standard menu, or Extended menu for the UK.
     */
    public get AutoSpinType(): AutoSpinType
    {
        if (this._rgsConfig && this._rgsConfig.settings && this._rgsConfig.settings.uiDisplayOptions)
        {
            switch (this._rgsConfig.settings.uiDisplayOptions.autoSpin.type)
            {
                case "none":
                    return AutoSpinType.None;
                case "standard":
                    return AutoSpinType.Standard;
                case "extended":
                    return AutoSpinType.Extended;
            }
        }

        return AutoSpinType.None;
    }

    /**
     * The options to present the player for autospin amounts.
     */
    public get AutoSpinOptions(): number[]
    {
        if (this._rgsConfig && this._rgsConfig.settings && this._rgsConfig.settings.uiDisplayOptions)
        {
            return this._rgsConfig.settings.uiDisplayOptions.autoSpin.options;
        }

        return null;
    }

    /**
     * The maximum limit of allowed queued autoplays.
     */
    public get AutoSpinLimit(): number
    {
        if (this._rgsConfig && this._rgsConfig.settings && this._rgsConfig.settings.uiDisplayOptions)
        {
            if (this._rgsConfig.settings.uiDisplayOptions.autoSpin.max)
            {
                return this._rgsConfig.settings.uiDisplayOptions.autoSpin.max;
            }
            else if (this.AutoSpinOptions)
            {
                return this.AutoSpinOptions[this.AutoSpinOptions.length - 1];
            }
        }
    }

    /**
     * Collection of {IBetConfig} to use for wagering.
     */
    public get BetConfigs(): Map<string, IBetConfig>
    {
        return this._rgsConfig.betConfigs;
    }

    public GetBetConfig(betConfigId: number): IBetConfig
    {
        return this._rgsConfig.betConfigs[betConfigId.toString()];
    }

    /**
     * Number of the last play from the last session.
     */
    public get CurrentPlay(): number
    {
        if (!this._rgsConfig) { return null; }

        let currentState: IPlayState = this.LastPlayState;
        let playId: number = currentState.playResult.playId;
        return playId;
    }

    /**
     * Round number of the last play from the last session.
     */
    public get CurrentRound(): number
    {
        if (!this._rgsConfig) { return null; }

        let currentState: IPlayState = this.LastPlayState;
        let roundID: number = currentState.playResult.PlaySequenceNumber;
        return roundID;
    }

    /**
     * Default bet settings to use when not recovering.
     */
    public get DefaultBet(): IDefaultBet
    {
        return this._rgsConfig ? this._rgsConfig.defaultBet : null;
    }

    /**
     * Collection of {IDenomConfig} to use for wagering.
     */
    public get DenomConfigs(): Map<string, IDenomConfig>
    {
        return this._rgsConfig ? this._rgsConfig.denomConfigs : null;
    }

    /**
     * Player's wallet balance at game launch.
     */
    public get InitialBalanceMC(): number
    {
        if (this._rgsConfig == null) { return; }
        return 200000;
        // TODO: If in recovery grab StartRoundMC
    }

    /**
     * Whether or not keyboard inputs should be allowed.
     */
    public get KeyboardEnabled(): boolean
    {
        if (this._rgsConfig && this._rgsConfig.settings)
        {
            return this._rgsConfig.settings.keyboardEnabled;
        }

        return false;
    }

    /**
     * The play result of the last play of the last session.
     */
    public get LastPlayResult(): IPlayResultData
    {
        if (this._rgsConfig == null) { return null; }
        let currentState: IPlayState = this.LastPlayState;
        let resultData: IPlayResultData = new PlayResultData(currentState.playResult);
        return resultData;
    }

    /**
     * The play state of the last play of the last session.
     */
    public get LastPlayState(): IPlayState
    {
        if (this._rgsConfig == null) { return null; }

        return this._rgsConfig.roundStates
            ? this._rgsConfig.roundStates[0]
            : (this._rgsConfig.previousRoundState || null);
    }

    /**
     * URL that the lobby button should exit to.
     */
    public get LobbyURL(): string
    {
        if (this._clientConfig && this._clientConfig.lobbyUrl)
        {
            return this._clientConfig.lobbyUrl;
        }

        if (this._rgsConfig && this._rgsConfig.settings)
        {
            return this._rgsConfig.settings.lobbyUrl;
        }

        return window.location.href;
    }

    public HasLobbyURL(): boolean
    {
        if (this._clientConfig && this._clientConfig.lobbyUrl) { return true; }
        if (this._rgsConfig && this._rgsConfig.settings.lobbyUrl) { return true; }
        return false;
    }

    public get LobbyWindow(): Window
    {
        if (this._rgsConfig && this._rgsConfig.settings && this._rgsConfig.settings.lobbyWindowDepth)
        {
            if (this._rgsConfig.settings.lobbyWindowDepth === "parent")
            {
                return window.parent;
            }
        }

        return window.top;
    }

    public NavigateToLobby(): void {
        this.LobbyWindow.location.href = this.LobbyURL;
    }

    public ReloadPage(): void {
        if (!window  || !window.location) { return; }
        window.location.reload();
    }

    /**
     * Minimum spin duration that should be enforced by the {ReelManager}.
     */
    public get MinSpinDelay(): number
    {
        if (this._rgsConfig && this._rgsConfig.settings)
        {
            return this._rgsConfig.settings.minimumSpinDelay;
        }

        return 0;
    }

    /**
     * Whether or not the RGS server supports prize forcing or not.
     */
    public get IsPrizeForceEnabled(): boolean
    {
        if (!this._rgsConfig) { return false; }

        const settings: ISettings = this._rgsConfig.settings;
        if (!settings) { return false; }

        return this._rgsConfig.settings.disableDemo === true
            ? false
            : settings.prizeForceEnabled;
    }

    /**
     * Whether or not players should be allowed to quickstop.
     */
    public get QuickStopPermitted(): boolean
    {
        if (this._rgsConfig && this._rgsConfig.settings)
        {
            return this._rgsConfig.settings.quickStopEnabled;
        }

        return true;
    }

    /**
     * How many recall entries should be fetched and displayed.
     */
    public get RecallHistory(): number
    {
        {
            if (this._rgsConfig
                && this._rgsConfig.settings.uiDisplayOptions
                && this._rgsConfig.settings.uiDisplayOptions.recall)
            {
                return this._rgsConfig.settings.uiDisplayOptions.recall.history;
            }
        }

        return new RecallOptions().history;
    }

    /**
     * The RTP of the game's wager config.
     */
    public get RTP(): number
    {
        // FIXME : Get real RTP once it is being supplied by the server.
        return 95.88;
    }

    /**
     * Server timestamp string.
     */
    public get ServerTime(): number
    {
        if (this._rgsConfig)
        {
            return this._rgsConfig.time;
        }

        return 0;
    }

    /**
     * IANA time zone string of the RGS server's location.
     */
    public get ServerTimeZone(): string
    {
        if (this._rgsConfig)
        {
            return this._rgsConfig.settings.juris.timeZone;
        }

        return "";
    }

    /**
     * Time zone offset in seconds, pulled from config if present or server directly if not
     */
    public get ServerTimeZoneOffset(): number
    {
        let offsetHours: number = 0;
        if (this._rgsConfig)
        {
            if (this._rgsConfig.settings.juris && this._rgsConfig.settings.juris.timeZone)
            {
                let timeZoneStr: string = this._rgsConfig.settings.juris.timeZone;
                offsetHours = parseInt(timeZoneStr.split("UTC")[1], 10);
            }
            else
            {
                offsetHours = this._rgsConfig.rgsTzOffset;
            }
        }

        let offsetSeconds: number = offsetHours * 3600;
        return offsetSeconds;
    }

    public get UseLocalTimeZone(): boolean
    {
        if (this._rgsConfig)
        {
            if (this._rgsConfig.settings.juris && this._rgsConfig.settings.juris.useLocalTimeZone)
            {
                return this._rgsConfig.settings.juris.useLocalTimeZone;
            }
        }
        return false;
    }

    /**
     * Array of social bet scale values
     */
    public get BetScalers(): number[]
    {
        if (!this._rgsConfig || !this._rgsConfig.platformBetOption) { return null; }
        return (this._rgsConfig.platformBetOption as IPlatformBetOption).list;
    }

    /**
     * Default social bet scale value
     */
    public get DefaultBetScale(): number
    {
        if (!this._rgsConfig || !this._rgsConfig.platformBetOption) { return -1; }
        return (this._rgsConfig.platformBetOption as IPlatformBetOption).defaultMult;
    }

    /**
     * Checks the configuration if a certain component of the UI should be displayed or not.
     * @param key DisplayKey for the piece of UI we are checking.
     * @returns Whether or not the UI piece should be displayed.
     */
    public ShouldDisplay(key: DisplayKey): boolean
    {
        if (!this._rgsConfig ||
            !this._rgsConfig.settings ||
            !this._rgsConfig.settings.uiDisplayOptions)
        {
            return false;
        }

        switch (key)
        {
            case DisplayKey.AutoSpin:
                // tslint:disable-next-line:max-line-length
                return this._rgsConfig.settings.uiDisplayOptions.autoSpin.type !== AutoSpinType[AutoSpinType.None].toLowerCase();
            case DisplayKey.Balance:
                return this._rgsConfig.settings.uiDisplayOptions.balance;
            case DisplayKey.Bet:
                return this._rgsConfig.settings.uiDisplayOptions.bet;
            case DisplayKey.Help:
                return this._rgsConfig.settings.uiDisplayOptions.help;
            case DisplayKey.Language:
                return this._rgsConfig.settings.uiDisplayOptions.language;
            case DisplayKey.Lobby:
            {
                let displayLobby: boolean = this._rgsConfig.settings.uiDisplayOptions.lobby && this.HasLobbyURL();
                if (displayLobby)
                {
                    let exclusion: string = this._rgsConfig.settings.uiDisplayOptions.lobbyExclusion;
                    if (exclusion === "web") // If excluding web, only display in WebView (app)
                    {
                        if (this.IsWebView() === false) { displayLobby = false; }
                    }
                    else if (exclusion === "webview")
                    {
                        if (this.IsWebView() === true) { displayLobby = false; }
                    }
                }
                return displayLobby;
            }
            case DisplayKey.Recall:
                return this._rgsConfig.settings.uiDisplayOptions.recall.enabled;
            case DisplayKey.RTP:
                return this._rgsConfig.settings.uiDisplayOptions.rtp;
            case DisplayKey.ServerTime:
                return this._rgsConfig.settings.uiDisplayOptions.serverTime && !this.Recall;
            case DisplayKey.SessionTime:
                return this._rgsConfig.settings.uiDisplayOptions.sessionTime && !this.Recall;
            case DisplayKey.Settings:
                return this._rgsConfig.settings.uiDisplayOptions.settings;
            case DisplayKey.Sound:
                return this._rgsConfig.settings.uiDisplayOptions.sound;
            case DisplayKey.Turbo:
                return this._rgsConfig.settings.uiDisplayOptions.turbo && this.QuickStopPermitted;
            case DisplayKey.Social:
                return this.GameStyle === GameType.Social;
            case DisplayKey.ForWager:
                return this.GameStyle === GameType.Wager;
            case DisplayKey.GameInfo:
                return this._rgsConfig.settings.uiDisplayOptions.gameName && !this.Recall;
            case DisplayKey.Demo:
                return this.IsPrizeForceEnabled && !this.Recall;
            case DisplayKey.QuickStop:
                return this.QuickStopPermitted;
            case DisplayKey.KeyboardControls:
                return this.KeyboardEnabled;
        }
    }

    /**
     * Checks the user agent to determine if the game is running in a WebView (iOS or Android)
     * @returns Whether or not the game is running in a WebView
     */
    public IsWebView(): boolean
    {
        let userAgent: string = window.navigator.userAgent.toLowerCase();
        let safari: boolean = /safari/.test( userAgent );
        let ios: boolean = /iphone|ipod|ipad/.test( userAgent );

        if (ios)
        {
            if (safari)
            {
                // browser
                return false;
            }
            else if (!safari)
            {
                // webview
                return true;
            }
        }
        else
        {
            // not iOS
            let chromeWebView: boolean = /version\/.+(chrome)\/(\d+)\.(\d+)\.(\d+)\.(\d+)/.test( userAgent );
            return chromeWebView;
        }
    }

    /**
     * Whether the playbar meters should display cash, credits, or toggle between the two.
     */
    public get WagerDisplay(): WagerDisplay
    {
        if (this._rgsConfig && this._rgsConfig.settings)
        {
            switch (this._rgsConfig.settings.wagerDisplay)
            {
                case "cash":
                    return WagerDisplay.Cash;
                case "credits":
                    return WagerDisplay.Credits;
                case "toggle":
                    return WagerDisplay.Toggle;
            }
        }

        return WagerDisplay.Credits;
    }

    /**
     * The wager version.
     */
    public get WagerVersion(): number
    {
        if (this._rgsConfig)
        {
            return this._rgsConfig.version;
        }

        return null;
    }

    // #endregion

    /**
     * Retrieve a specific previous play from cached store.
     * @param roundId The round in which to search for the specified playId.
     * @param playId The ID of the play we are looking for.
     * @returns The stringified JSON representation of the requested previous result. If the requested playId is
     * not found, the most recent play result is returned instead.
     */
    public GetPreviousResult(roundId: number, playId: number): string
    {
        if (this._rgsConfig.roundStates == null)
        {
            CLog.error("Tried to get a previous result, but no roundStates found");
            return null;
        }

        let foundRound: IPlayState = null;

        this._rgsConfig.roundStates.forEach((round) =>
        {
            if (round.playResult.PlaySequenceNumber === roundId && round.playResult.GamePlayIndex === playId)
            {
                foundRound = round;
                return;
            }
        });

        if (foundRound == null)
        {
            CLog.error('Tried to get a previous result, but no roundState found'
                + ` for round ${roundId}, play ${playId}. Reverting to latest.`);
            foundRound = this.LastPlayState;
        }

        return JSON.stringify(foundRound);
    }

    public get Settings(): ISettings
    {
        return this._rgsConfig.settings;
    }

    public GetGameUri(params: Object = null): string
    {
        const sessionInfo: IGameUri =
        {
            jurisdictionId: this.Jurisdiction,
            platformId: this.PlatformID,
            operatorId: this.OperatorID,
            userId: this.UserID,
            token: this.UserToken,
            locale: CultureID[this.Locale]
        };

        return  new UriBuilder(`${this.GameID}/`)
                    .AddParams(sessionInfo, params)
                    .toString(true);
    }
}

interface IGameUri
{
    jurisdictionId: string;
    platformId: string;
    operatorId: string;
    userId: string;
    token: string;
    locale: string;
}
