import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { requestPost, toCamelCase } from "../utils";
import i18n from "../i18n";
import { staticStore } from "./store";

async function _updateLocalConfig(key: string, value: any, showSuccessMessage = true) {
  try {
    const res = await requestPost("/api/config/update_config", { key, value });
    if (showSuccessMessage) staticStore.messageApi?.success(res.message);
  } catch (error: any) {
    staticStore.messageApi?.error(error);
  }
}

const debounceMap = new Map<string, ReturnType<typeof setTimeout>>();
function updateLocalConfig(key: string, value: any, time = 500, showSuccessMessage = true) {
  if (debounceMap.has(key)) clearTimeout(debounceMap.get(key)!);
  const timeout = setTimeout(() => {
    _updateLocalConfig(key, value, showSuccessMessage);
    debounceMap.delete(key);
  }, time);
  debounceMap.set(key, timeout);
}

export type ScrcpyParameterScope = "server" | "clientOnly";

export interface ScrcpyParameter {
  id: string;
  enabled: boolean;
  key: string;
  value: string;
  scope: ScrcpyParameterScope;
}

export interface ScrcpyPreset {
  id: string;
  name: string;
  video: boolean;
  audio: boolean;
  virtualDisplay: ScrcpyVirtualDisplayConfig;
  parameters: ScrcpyParameter[];
}

export interface ScrcpyVirtualDisplayConfig {
  enabled: boolean;
  useMainSize: boolean;
  width: number;
  height: number;
  dpi: number;
  keepActive: boolean;
  destroyContent: boolean;
  systemDecorations: boolean;
  startAppEnabled: boolean;
  startAppPackage: string;
  startAppForceStop: boolean;
}

export function defaultScrcpyVirtualDisplay(): ScrcpyVirtualDisplayConfig {
  return {
    enabled: false,
    useMainSize: true,
    width: 1280,
    height: 720,
    dpi: 240,
    keepActive: true,
    destroyContent: false,
    systemDecorations: true,
    startAppEnabled: false,
    startAppPackage: "",
    startAppForceStop: false,
  };
}

export interface ScrcpyModuleConfig {
  enabled: boolean;
  activePresetId: string;
  presets: ScrcpyPreset[];
}

export function qualcommHevcLowLatencyPreset(): ScrcpyPreset {
  return {
    id: "qualcomm-hevc-low-latency",
    name: "Qualcomm H.265 低延迟",
    video: true,
    audio: false,
    virtualDisplay: defaultScrcpyVirtualDisplay(),
    parameters: [
      { id: "video-codec", enabled: true, key: "video_codec", value: "h265", scope: "server" },
      { id: "video-encoder", enabled: true, key: "video_encoder", value: "c2.qti.hevc.encoder.cq", scope: "server" },
      { id: "video-bit-rate", enabled: true, key: "video_bit_rate", value: "5000000", scope: "server" },
      { id: "max-fps", enabled: true, key: "max_fps", value: "60", scope: "server" },
      { id: "mouse", enabled: true, key: "mouse", value: "uhid", scope: "clientOnly" },
      { id: "video-buffer", enabled: true, key: "video_buffer", value: "0", scope: "clientOnly" },
    ],
  };
}

function defaultScrcpyModule(): ScrcpyModuleConfig {
  const preset = qualcommHevcLowLatencyPreset();
  return { enabled: false, activePresetId: preset.id, presets: [preset] };
}

export interface LocalConfigState {
  webPort: number;
  webBindAddr: string;
  controllerPort: number;
  adbPath: string;
  adbConnectAddress: string;
  alwaysOnTop: boolean;
  titlebarVisible: boolean;
  verticalMaskHeight: number;
  horizontalMaskWidth: number;
  verticalPosition: [number, number];
  horizontalPosition: [number, number];
  mappingEnabled: boolean;
  activeMappingFile: string;
  mappingLabelOpacity: number;
  language: string;
  clipboardSync: boolean;
  videoCodec: string;
  videoEncoder: string;
  videoCodecOptions: string;
  qualcommLowLatency: boolean;
  videoBitRate: number;
  videoMaxSize: number;
  videoMaxFps: number;
  displayId: number;
  newDisplayEnabled: boolean;
  newDisplayUseMainSize: boolean;
  newDisplayWidth: number;
  newDisplayHeight: number;
  newDisplayDpi: number;
  newDisplayStartAppEnabled: boolean;
  newDisplayStartAppPackage: string;
  newDisplayStartAppForceStop: boolean;
  audioCodec: string;
  audioBitRate: number;
  audioSource: string;
  audioDup: boolean;
  scrcpyModule: ScrcpyModuleConfig;
  stayAwake: boolean;
  screenOffTimeout: number;
  powerOffOnClose: boolean;
}

const initialState: LocalConfigState = {
  webPort: 0,
  webBindAddr: "127.0.0.1",
  controllerPort: 0,
  adbPath: "",
  adbConnectAddress: "",
  alwaysOnTop: true,
  titlebarVisible: true,
  verticalMaskHeight: 0,
  horizontalMaskWidth: 0,
  verticalPosition: [0, 0],
  horizontalPosition: [0, 0],
  mappingEnabled: true,
  activeMappingFile: "",
  mappingLabelOpacity: 0.3,
  language: "en-US",
  clipboardSync: true,
  videoCodec: "H264",
  videoEncoder: "c2.qti.avc.encoder",
  videoCodecOptions: "",
  qualcommLowLatency: false,
  videoBitRate: 12000000,
  videoMaxSize: 0,
  videoMaxFps: 60,
  displayId: 0,
  newDisplayEnabled: false,
  newDisplayUseMainSize: true,
  newDisplayWidth: 1280,
  newDisplayHeight: 720,
  newDisplayDpi: 240,
  newDisplayStartAppEnabled: false,
  newDisplayStartAppPackage: "",
  newDisplayStartAppForceStop: false,
  audioCodec: "OPUS",
  audioBitRate: 128000,
  audioSource: "OUTPUT",
  audioDup: false,
  scrcpyModule: defaultScrcpyModule(),
  stayAwake: false,
  screenOffTimeout: -1,
  powerOffOnClose: false,
};

const localConfigSlice = createSlice({
  name: "localConfig",
  initialState,
  reducers: {
    forceSetLocalConfig: (state, action: PayloadAction<any>) => {
      for (const [key, value] of Object.entries(action.payload)) {
        const curKey = toCamelCase(key);
        if (curKey in state) (state as any)[curKey] = value;
      }
    },
    setWebPort: (state, action: PayloadAction<number>) => { state.webPort = action.payload; updateLocalConfig("web_port", action.payload); },
    setWebBindAddr: (state, action: PayloadAction<string>) => { state.webBindAddr = action.payload; updateLocalConfig("web_bind_addr", action.payload, 1000); },
    setControllerPort: (state, action: PayloadAction<number>) => { state.controllerPort = action.payload; updateLocalConfig("controller_port", action.payload); },
    setAdbPath: (state, action: PayloadAction<string>) => { state.adbPath = action.payload; updateLocalConfig("adb_path", action.payload, 1000); },
    setAdbConnectAddress: (state, action: PayloadAction<string>) => { state.adbConnectAddress = action.payload; updateLocalConfig("adb_connect_address", action.payload, 0, false); },
    setAlwaysOnTop: (state, action: PayloadAction<boolean>) => { state.alwaysOnTop = action.payload; updateLocalConfig("always_on_top", action.payload); },
    setTitlebarVisible: (state, action: PayloadAction<boolean>) => { state.titlebarVisible = action.payload; updateLocalConfig("titlebar_visible", action.payload); },
    setverticalMaskHeight: (state, action: PayloadAction<number>) => { state.verticalMaskHeight = action.payload; updateLocalConfig("vertical_mask_height", action.payload, 1000); },
    sethorizontalMaskWidth: (state, action: PayloadAction<number>) => { state.horizontalMaskWidth = action.payload; updateLocalConfig("horizontal_mask_width", action.payload, 1000); },
    setVerticalPosition: (state, action: PayloadAction<[number, number]>) => { state.verticalPosition = action.payload; updateLocalConfig("vertical_position", action.payload, 1000); },
    setHorizontalPosition: (state, action: PayloadAction<[number, number]>) => { state.horizontalPosition = action.payload; updateLocalConfig("horizontal_position", action.payload, 1000); },
    setMappingEnabled: (state, action: PayloadAction<boolean>) => { state.mappingEnabled = action.payload; updateLocalConfig("mapping_enabled", action.payload, 0); },
    setActiveMappingFile: (state, action: PayloadAction<string>) => { state.activeMappingFile = action.payload; },
    setMappingLabelOpacity: (state, action: PayloadAction<number>) => { state.mappingLabelOpacity = action.payload; updateLocalConfig("mapping_label_opacity", action.payload); },
    setLanguage: (state, action: PayloadAction<string>) => { state.language = action.payload; i18n.changeLanguage(action.payload); updateLocalConfig("language", action.payload); },
    setClipboardSync: (state, action: PayloadAction<boolean>) => { state.clipboardSync = action.payload; updateLocalConfig("clipboard_sync", action.payload); },
    setVideoCodec: (state, action: PayloadAction<string>) => { state.videoCodec = action.payload; updateLocalConfig("video_codec", action.payload); },
    setVideoEncoder: (state, action: PayloadAction<string>) => { state.videoEncoder = action.payload; updateLocalConfig("video_encoder", action.payload, 700); },
    setVideoCodecOptions: (state, action: PayloadAction<string>) => { state.videoCodecOptions = action.payload; updateLocalConfig("video_codec_options", action.payload, 700); },
    setQualcommLowLatency: (state, action: PayloadAction<boolean>) => { state.qualcommLowLatency = action.payload; updateLocalConfig("qualcomm_low_latency", action.payload, 0); },
    setVideoBitRate: (state, action: PayloadAction<number>) => { state.videoBitRate = action.payload; updateLocalConfig("video_bit_rate", action.payload); },
    setVideoMaxSize: (state, action: PayloadAction<number>) => { state.videoMaxSize = action.payload; updateLocalConfig("video_max_size", action.payload); },
    setVideoMaxFps: (state, action: PayloadAction<number>) => { state.videoMaxFps = action.payload; updateLocalConfig("video_max_fps", action.payload); },
    setDisplayId: (state, action: PayloadAction<number>) => { state.displayId = action.payload; updateLocalConfig("display_id", action.payload); },
    setNewDisplayEnabled: (state, action: PayloadAction<boolean>) => { state.newDisplayEnabled = action.payload; updateLocalConfig("new_display_enabled", action.payload); },
    setNewDisplayUseMainSize: (state, action: PayloadAction<boolean>) => { state.newDisplayUseMainSize = action.payload; updateLocalConfig("new_display_use_main_size", action.payload); },
    setNewDisplayWidth: (state, action: PayloadAction<number>) => { state.newDisplayWidth = action.payload; updateLocalConfig("new_display_width", action.payload); },
    setNewDisplayHeight: (state, action: PayloadAction<number>) => { state.newDisplayHeight = action.payload; updateLocalConfig("new_display_height", action.payload); },
    setNewDisplayDpi: (state, action: PayloadAction<number>) => { state.newDisplayDpi = action.payload; updateLocalConfig("new_display_dpi", action.payload); },
    setNewDisplayStartAppEnabled: (state, action: PayloadAction<boolean>) => { state.newDisplayStartAppEnabled = action.payload; updateLocalConfig("new_display_start_app_enabled", action.payload, 0); },
    setNewDisplayStartAppPackage: (state, action: PayloadAction<string>) => { state.newDisplayStartAppPackage = action.payload; updateLocalConfig("new_display_start_app_package", action.payload, 800); },
    setNewDisplayStartAppForceStop: (state, action: PayloadAction<boolean>) => { state.newDisplayStartAppForceStop = action.payload; updateLocalConfig("new_display_start_app_force_stop", action.payload, 0); },
    setAudioCodec: (state, action: PayloadAction<string>) => { state.audioCodec = action.payload; updateLocalConfig("audio_codec", action.payload); },
    setAudioBitRate: (state, action: PayloadAction<number>) => { state.audioBitRate = action.payload; updateLocalConfig("audio_bit_rate", action.payload); },
    setAudioSource: (state, action: PayloadAction<string>) => {
      state.audioSource = action.payload;
      if (action.payload !== "PLAYBACK") { state.audioDup = false; updateLocalConfig("audio_dup", false); }
      updateLocalConfig("audio_source", action.payload);
    },
    setAudioDup: (state, action: PayloadAction<boolean>) => { state.audioDup = action.payload; updateLocalConfig("audio_dup", action.payload); },
    setScrcpyModule: (state, action: PayloadAction<ScrcpyModuleConfig>) => {
      state.scrcpyModule = action.payload;
      updateLocalConfig("scrcpy_module", action.payload, 0);
    },
    setStayAwake: (state, action: PayloadAction<boolean>) => { state.stayAwake = action.payload; updateLocalConfig("stay_awake", action.payload); },
    setScreenOffTimeout: (state, action: PayloadAction<number>) => { state.screenOffTimeout = action.payload; updateLocalConfig("screen_off_timeout", action.payload); },
    setPowerOffOnClose: (state, action: PayloadAction<boolean>) => { state.powerOffOnClose = action.payload; updateLocalConfig("power_off_on_close", action.payload); },
  },
});

export const {
  forceSetLocalConfig,
  setWebPort,
  setWebBindAddr,
  setControllerPort,
  setAdbPath,
  setAdbConnectAddress,
  setAlwaysOnTop,
  setTitlebarVisible,
  setverticalMaskHeight,
  sethorizontalMaskWidth,
  setVerticalPosition,
  setHorizontalPosition,
  setMappingEnabled,
  setActiveMappingFile,
  setMappingLabelOpacity,
  setLanguage,
  setClipboardSync,
  setVideoCodec,
  setVideoEncoder,
  setVideoCodecOptions,
  setQualcommLowLatency,
  setVideoBitRate,
  setVideoMaxSize,
  setVideoMaxFps,
  setDisplayId,
  setNewDisplayEnabled,
  setNewDisplayUseMainSize,
  setNewDisplayWidth,
  setNewDisplayHeight,
  setNewDisplayDpi,
  setNewDisplayStartAppEnabled,
  setNewDisplayStartAppPackage,
  setNewDisplayStartAppForceStop,
  setAudioCodec,
  setAudioBitRate,
  setAudioSource,
  setAudioDup,
  setScrcpyModule,
  setStayAwake,
  setScreenOffTimeout,
  setPowerOffOnClose,
} = localConfigSlice.actions;
export default localConfigSlice.reducer;
