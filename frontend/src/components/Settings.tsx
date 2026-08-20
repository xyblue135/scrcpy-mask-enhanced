import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "../store/store";
import { ItemBox, ItemBoxContainer } from "./common/ItemBox";
import {
  Alert,
  AutoComplete,
  Badge,
  Button,
  Card,
  Flex,
  Input,
  InputNumber,
  Select,
  Slider,
  Space,
  Switch,
  Typography,
} from "antd";
import {
  forceSetLocalConfig,
  setAdbPath,
  setAlwaysOnTop,
  setAudioBitRate,
  setAudioCodec,
  setAudioDup,
  setAudioSource,
  setClipboardSync,
  setControllerPort,
  setDisplayId,
  setHorizontalPosition,
  setLanguage,
  setMappingEnabled,
  setMappingLabelOpacity,
  setNewDisplayDpi,
  setNewDisplayEnabled,
  setNewDisplayHeight,
  setNewDisplayStartAppEnabled,
  setNewDisplayStartAppForceStop,
  setNewDisplayStartAppPackage,
  setNewDisplayUseMainSize,
  setNewDisplayWidth,
  setPowerOffOnClose,
  setQualcommLowLatency,
  setScreenOffTimeout,
  setScrcpyModule,
  setStayAwake,
  setTitlebarVisible,
  setVerticalPosition,
  setVideoBitRate,
  setVideoCodec,
  setVideoCodecOptions,
  setVideoEncoder,
  setVideoMaxFps,
  setVideoMaxSize,
  setWebBindAddr,
  setWebPort,
  sethorizontalMaskWidth,
  setverticalMaskHeight,
} from "../store/localConfig";
import { setIsLoading, setShowUpdateDialog, setUpdateInfo } from "../store/other";
import { requestGet } from "../utils";
import i18n, { languageOptions } from "../i18n";
import { useMessageContext } from "../hooks";
import { BilibiliFilled, CloudSyncOutlined, GithubFilled, InfoCircleOutlined, SyncOutlined } from "@ant-design/icons";
import ScrcpyModuleModal from "./ScrcpyModuleModal";

const videoCodecOptions = ["H264", "H265", "AV1"].map((v) => ({ value: v, label: v }));
const audioCodecOptions = ["OPUS", "AAC", "FLAC", "RAW"].map((v) => ({ value: v, label: v }));
const audioSourceOptions = ["OUTPUT", "PLAYBACK", "MIC"].map((v) => ({ value: v, label: v }));
const webBindAddrOptions = [
  { value: "127.0.0.1", label: "127.0.0.1" },
  { value: "0.0.0.0", label: "0.0.0.0" },
];
const fpsPresetValues = [0, 30, 60, 90, 120];

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card size="small" className="mb-5" title={title} extra={subtitle ? <Typography.Text type="secondary">{subtitle}</Typography.Text> : undefined}>
      {children}
    </Card>
  );
}

export default function Settings() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const messageApi = useMessageContext();
  const localConfig = useAppSelector((state) => state.localConfig);
  const updateInfo = useAppSelector((state) => state.other.updateInfo);
  const isZh = i18n.language.toLowerCase().startsWith("zh");
  const ui = isZh
    ? {
        basic: "基础 / 窗口",
        mapping: "键盘映射",
        virtual: "虚拟屏幕",
        video: "视频 / 低延迟",
        audio: "音频",
        device: "设备行为",
        advanced: "连接 / 高级",
        enabled: "启用",
        mappingEnabled: "启用键盘映射",
        mappingEnabledTip: "关闭后停止键盘/鼠标映射；设置会保存，下次启动仍保持关闭。默认开启。",
        encoder: "视频编码器",
        codecOptions: "Codec Options",
        qcom: "Qualcomm 低延迟（实验）",
        qcomTip: "给高通编码器追加 vendor 低延迟参数。不同 ROM/编码器兼容性不同，建议与关闭状态做 A/B 测试。",
        fpsMode: "帧率上限",
        fpsTip: "这是编码帧率上限，不会强制手机关闭动态 FPS；修改后重新建立投屏连接生效。",
        follow: "跟随设备（不限制）",
        custom: "自定义",
        startApp: "虚拟屏启动指定应用",
        package: "应用包名",
        forceStop: "启动前强制停止应用",
        virtualNote: "部分手机创建虚拟屏后无法通过虚拟桌面正常进入应用。开启后填写包名，LowCast 会在虚拟屏建立完成后直接通过 scrcpy 控制通道启动应用。虚拟屏现在默认采用常驻策略：Alt+Tab、最小化、打开设置、F11/最大化不会主动销毁会话；若确实发生重连或异常断开，LowCast 会要求 Android 保留应用任务而不是销毁，尽量避免再次进入时冷启动。",
        restartTip: "视频、虚拟屏相关参数通常在下一次重新建立投屏连接时生效。",
        displayTip: "刷新键位背景现在直接使用 LowCast 当前正在显示的视频帧，不再调用 ADB 截屏；因此虚拟屏模式下会保存你此刻实际看到的虚拟屏画面。",
        windowTip: "F11 = 无边框全屏；右上角最大化 = 普通 Windows 最大化并保留任务栏。两者都保持画面宽高比，多余区域显示黑边。",
      }
    : {
        basic: "General / Window",
        mapping: "Keyboard Mapping",
        virtual: "Virtual Display",
        video: "Video / Low Latency",
        audio: "Audio",
        device: "Device Behavior",
        advanced: "Connection / Advanced",
        enabled: "Enabled",
        mappingEnabled: "Enable keyboard mapping",
        mappingEnabledTip: "Disables keyboard/mouse mappings persistently. Enabled by default.",
        encoder: "Video encoder",
        codecOptions: "Codec options",
        qcom: "Qualcomm low latency (experimental)",
        qcomTip: "Adds Qualcomm vendor low-latency options. Compatibility varies by ROM/encoder; A/B test it.",
        fpsMode: "FPS limit",
        fpsTip: "This caps encoded FPS; it does not disable the phone's dynamic refresh rate. Reconnect to apply.",
        follow: "Follow device (unlimited)",
        custom: "Custom",
        startApp: "Start app on virtual display",
        package: "App package",
        forceStop: "Force-stop before launch",
        virtualNote: "Some phones cannot enter apps from the virtual desktop. Enable this and enter a package name so LowCast starts it through the scrcpy control channel after the virtual display is ready. Virtual-display persistence is now enabled by default: Alt+Tab, minimize, Settings, F11 and maximize do not intentionally destroy the session; on a real reconnect or unexpected disconnect, Android is asked to preserve the app task instead of destroying it to reduce cold reloads.",
        restartTip: "Video and virtual-display changes normally apply after reconnecting the stream.",
        displayTip: "Mapping background refresh now uses the exact frame currently displayed by LowCast. It no longer calls ADB screencap, so virtual-display mode captures the virtual-screen picture you are actually seeing.",
        windowTip: "F11 is borderless fullscreen; the title-bar maximize button is normal Windows maximization with the taskbar visible. Both preserve aspect ratio and use black bars.",
      };

  const [customFpsMode, setCustomFpsMode] = useState(false);
  const [scrcpyModuleOpen, setScrcpyModuleOpen] = useState(false);
  const fpsPresetValue = customFpsMode || !fpsPresetValues.includes(localConfig.videoMaxFps) ? "custom" : String(localConfig.videoMaxFps);
  const activeScrcpyPreset = localConfig.scrcpyModule.presets.find(
    (preset) => preset.id === localConfig.scrcpyModule.activePresetId,
  );

  async function loadLocalConfig() {
    dispatch(setIsLoading(true));
    try {
      const res = await requestGet("/api/config/get_config");
      dispatch(forceSetLocalConfig(res.data));
      i18n.changeLanguage(res.data.language);
    } catch (err: any) {
      messageApi?.error(err);
    }
    dispatch(setIsLoading(false));
  }

  async function openDataPath() {
    dispatch(setIsLoading(true));
    try {
      const res = await requestGet("/api/config/open_data_path");
      messageApi?.success(res.message);
    } catch (err: any) {
      messageApi?.error(err);
    }
    dispatch(setIsLoading(false));
  }

  async function checkUpdate() {
    try {
      const res = await requestGet("/api/config/check_update");
      dispatch(setUpdateInfo({
        currentVersion: res.data.current_version,
        hasUpdate: res.data.has_update,
        latestVersion: res.data.latest_version,
        title: res.data.title,
        body: res.data.body,
        time: res.data.time,
      }));
      if (res.data.has_update) dispatch(setShowUpdateDialog(true));
    } catch (err: any) {
      messageApi?.error(err);
    }
  }

  return (
    <div className="page-container">
      <section>
        <Flex align="center" justify="space-between" className="mb-4">
          <div>
            <h2 className="title-with-line" style={{ marginBottom: 4 }}>{t("settings.title.header")}</h2>
            <Typography.Text type="secondary">LowCast · RMX3700 optimized</Typography.Text>
          </div>
          <Button type="primary" icon={<SyncOutlined />} shape="circle" onClick={loadLocalConfig} />
        </Flex>

        <Section title={ui.basic} subtitle="Window / UI">
          <ItemBoxContainer>
            <ItemBox label={t("settings.language")}><Select className="w-sm" value={localConfig.language} options={languageOptions} onChange={(v) => dispatch(setLanguage(v))} /></ItemBox>
            <ItemBox label={t("settings.clipboardSync")}><Switch checked={localConfig.clipboardSync} onChange={(v) => dispatch(setClipboardSync(v))} /></ItemBox>
            <ItemBox label={t("settings.alwaysOnTop")}><Switch checked={localConfig.alwaysOnTop} onChange={(v) => dispatch(setAlwaysOnTop(v))} /></ItemBox>
            <ItemBox label={t("settings.titlebarVisible")}><Switch checked={localConfig.titlebarVisible} onChange={(v) => dispatch(setTitlebarVisible(v))} /></ItemBox>
            <ItemBox label={t("settings.verticalMaskHeight")}><InputNumber className="w-sm" min={1} value={localConfig.verticalMaskHeight} onChange={(v) => v !== null && dispatch(setverticalMaskHeight(v))} /></ItemBox>
            <ItemBox label={t("settings.horizontalMaskWidth")}><InputNumber className="w-sm" min={1} value={localConfig.horizontalMaskWidth} onChange={(v) => v !== null && dispatch(sethorizontalMaskWidth(v))} /></ItemBox>
            <ItemBox label={t("settings.verticalMaskPosition")}><Space.Compact><InputNumber value={localConfig.verticalPosition[0]} onChange={(v) => v !== null && dispatch(setVerticalPosition([v, localConfig.verticalPosition[1]]))} /><InputNumber value={localConfig.verticalPosition[1]} onChange={(v) => v !== null && dispatch(setVerticalPosition([localConfig.verticalPosition[0], v]))} /></Space.Compact></ItemBox>
            <ItemBox label={t("settings.horizontalMaskPosition")}><Space.Compact><InputNumber value={localConfig.horizontalPosition[0]} onChange={(v) => v !== null && dispatch(setHorizontalPosition([v, localConfig.horizontalPosition[1]]))} /><InputNumber value={localConfig.horizontalPosition[1]} onChange={(v) => v !== null && dispatch(setHorizontalPosition([localConfig.horizontalPosition[0], v]))} /></Space.Compact></ItemBox>
          </ItemBoxContainer>
          <Alert className="mt-3" type="info" showIcon message={ui.windowTip} />
        </Section>

        <Section title={ui.mapping} subtitle={localConfig.mappingEnabled ? ui.enabled : "OFF"}>
          <ItemBoxContainer>
            <ItemBox label={ui.mappingEnabled} tooltip={ui.mappingEnabledTip}><Switch checked={localConfig.mappingEnabled} onChange={(v) => dispatch(setMappingEnabled(v))} /></ItemBox>
            <ItemBox label={t("settings.mappingLabelOpacity")}>
              <Slider style={{ width: 240 }} min={0} max={1} step={0.05} value={localConfig.mappingLabelOpacity} onChange={(v) => dispatch(setMappingLabelOpacity(v))} />
            </ItemBox>
          </ItemBoxContainer>
          <Alert className="mt-3" type="info" showIcon message={ui.displayTip} />
        </Section>

        <Section title={ui.virtual} subtitle="scrcpy new-display">
          <ItemBoxContainer>
            <ItemBox label={t("settings.newDisplayEnabled")} tooltip={t("settings.newDisplayEnabledTip")}><Switch checked={localConfig.newDisplayEnabled} onChange={(v) => dispatch(setNewDisplayEnabled(v))} /></ItemBox>
            <ItemBox label={t("settings.displayId")} tooltip={t("settings.displayIdTip")}><InputNumber className="w-sm" controls={false} disabled={localConfig.newDisplayEnabled} value={localConfig.displayId} onChange={(v) => v !== null && dispatch(setDisplayId(v))} /></ItemBox>
            <ItemBox label={t("settings.newDisplayUseMainSize")}><Switch checked={localConfig.newDisplayUseMainSize} disabled={!localConfig.newDisplayEnabled} onChange={(v) => dispatch(setNewDisplayUseMainSize(v))} /></ItemBox>
            <ItemBox label={t("settings.newDisplaySize")}>
              <Space.Compact>
                <InputNumber min={1} disabled={!localConfig.newDisplayEnabled || localConfig.newDisplayUseMainSize} value={localConfig.newDisplayWidth} onChange={(v) => v !== null && dispatch(setNewDisplayWidth(v))} />
                <InputNumber min={1} disabled={!localConfig.newDisplayEnabled || localConfig.newDisplayUseMainSize} value={localConfig.newDisplayHeight} onChange={(v) => v !== null && dispatch(setNewDisplayHeight(v))} />
              </Space.Compact>
            </ItemBox>
            <ItemBox label={t("settings.newDisplayDpi")}><InputNumber className="w-sm" min={1} disabled={!localConfig.newDisplayEnabled} value={localConfig.newDisplayDpi} onChange={(v) => v !== null && dispatch(setNewDisplayDpi(v))} /></ItemBox>
            <ItemBox label={ui.startApp}><Switch checked={localConfig.newDisplayStartAppEnabled} disabled={!localConfig.newDisplayEnabled} onChange={(v) => dispatch(setNewDisplayStartAppEnabled(v))} /></ItemBox>
            <ItemBox label={ui.package}><Input className="w-sm" placeholder="com.example.app" disabled={!localConfig.newDisplayEnabled || !localConfig.newDisplayStartAppEnabled} value={localConfig.newDisplayStartAppPackage} onChange={(e) => dispatch(setNewDisplayStartAppPackage(e.target.value))} /></ItemBox>
            <ItemBox label={ui.forceStop}><Switch checked={localConfig.newDisplayStartAppForceStop} disabled={!localConfig.newDisplayEnabled || !localConfig.newDisplayStartAppEnabled} onChange={(v) => dispatch(setNewDisplayStartAppForceStop(v))} /></ItemBox>
          </ItemBoxContainer>
          <Alert className="mt-3" type="warning" showIcon message={ui.virtualNote} />
        </Section>

        <Section title={ui.video} subtitle="H.264 / Qualcomm / FPS">
          <ItemBoxContainer>
            <ItemBox label={t("settings.videoCodec")}><Select className="w-sm" value={localConfig.videoCodec} options={videoCodecOptions} onChange={(v) => dispatch(setVideoCodec(v))} /></ItemBox>
            <ItemBox label={ui.encoder}><Input className="w-sm" value={localConfig.videoEncoder} placeholder="c2.qti.avc.encoder" onChange={(e) => dispatch(setVideoEncoder(e.target.value))} /></ItemBox>
            <ItemBox label={t("settings.videoBitRate")}><InputNumber className="w-sm" controls={false} min={1000000} suffix="bps" value={localConfig.videoBitRate} onChange={(v) => v !== null && dispatch(setVideoBitRate(v))} /></ItemBox>
            <ItemBox label={ui.fpsMode} tooltip={ui.fpsTip}>
              <Space.Compact>
                <Select style={{ width: 220 }} value={fpsPresetValue} options={[
                  { value: "0", label: ui.follow },
                  { value: "30", label: "30 FPS" },
                  { value: "60", label: "60 FPS（推荐）" },
                  { value: "90", label: "90 FPS" },
                  { value: "120", label: "120 FPS" },
                  { value: "custom", label: ui.custom },
                ]} onChange={(v) => {
                  if (v === "custom") setCustomFpsMode(true);
                  else { setCustomFpsMode(false); dispatch(setVideoMaxFps(Number(v))); }
                }} />
                {fpsPresetValue === "custom" && <InputNumber min={1} max={240} value={localConfig.videoMaxFps} addonAfter="FPS" onChange={(v) => v !== null && dispatch(setVideoMaxFps(v))} />}
              </Space.Compact>
            </ItemBox>
            <ItemBox label={t("settings.videoMaxSize")} tooltip={t("settings.zeroUnlimitedTip")}><InputNumber className="w-sm" controls={false} min={0} value={localConfig.videoMaxSize} onChange={(v) => v !== null && dispatch(setVideoMaxSize(v))} /></ItemBox>
            <ItemBox label={ui.codecOptions}><Input className="w-sm" value={localConfig.videoCodecOptions} placeholder="key=value,key2=value2" onChange={(e) => dispatch(setVideoCodecOptions(e.target.value))} /></ItemBox>
            <ItemBox label={ui.qcom} tooltip={ui.qcomTip}><Switch checked={localConfig.qualcommLowLatency} onChange={(v) => dispatch(setQualcommLowLatency(v))} /></ItemBox>
          </ItemBoxContainer>
          <Alert className="mt-3" type="info" showIcon message={ui.restartTip} />
        </Section>

        <Section title={ui.audio}>
          <ItemBoxContainer>
            <ItemBox label={t("settings.audioCodec")}><Select className="w-sm" value={localConfig.audioCodec} options={audioCodecOptions} onChange={(v) => dispatch(setAudioCodec(v))} /></ItemBox>
            <ItemBox label={t("settings.audioBitRate")}><InputNumber className="w-sm" min={16000} value={localConfig.audioBitRate} onChange={(v) => v !== null && dispatch(setAudioBitRate(v))} /></ItemBox>
            <ItemBox label={t("settings.audioSource")}><Select className="w-sm" value={localConfig.audioSource} options={audioSourceOptions} onChange={(v) => dispatch(setAudioSource(v))} /></ItemBox>
            <ItemBox label={t("settings.audioDup")} tooltip={t("settings.audioDupTip")}><Switch checked={localConfig.audioSource === "PLAYBACK" && localConfig.audioDup} disabled={localConfig.audioSource !== "PLAYBACK"} onChange={(v) => dispatch(setAudioDup(v))} /></ItemBox>
          </ItemBoxContainer>
        </Section>

        <Section
          title={isZh ? "关于 scrcpy / 完整参数调试中心" : "About scrcpy / Full Parameter Lab"}
          subtitle={localConfig.scrcpyModule.enabled ? activeScrcpyPreset?.name : "OFF"}
        >
          <ItemBoxContainer>
            <ItemBox label={isZh ? "启用参数模块" : "Enable preset module"}>
              <Switch
                checked={localConfig.scrcpyModule.enabled}
                onChange={(enabled) =>
                  dispatch(setScrcpyModule({ ...localConfig.scrcpyModule, enabled }))
                }
              />
            </ItemBox>
            <ItemBox label={isZh ? "当前预设" : "Active preset"}>
              <Typography.Text>{activeScrcpyPreset?.name ?? "-"}</Typography.Text>
            </ItemBox>
            <ItemBox>
              <Button type="primary" onClick={() => setScrcpyModuleOpen(true)}>
                {isZh ? "打开完整参数调试中心" : "Open full parameter lab"}
              </Button>
            </ItemBox>
          </ItemBoxContainer>
          <Alert
            className="mt-3"
            type="info"
            showIcon
            message={
              isZh
                ? "启用后，所选预设会在下一次连接设备时应用 scrcpy server 参数和虚拟屏配置。"
                : "When enabled, the selected preset applies its scrcpy server options and virtual-display configuration on the next connection."
            }
          />
        </Section>

        <Section title={ui.device}>
          <ItemBoxContainer>
            <ItemBox label={t("settings.stayAwake")}><Switch checked={localConfig.stayAwake} onChange={(v) => dispatch(setStayAwake(v))} /></ItemBox>
            <ItemBox label={t("settings.screenOffTimeout")} tooltip={t("settings.screenOffTimeoutTip")}><InputNumber className="w-sm" controls={false} min={-1} suffix="ms" value={localConfig.screenOffTimeout} onChange={(v) => v !== null && dispatch(setScreenOffTimeout(v))} /></ItemBox>
            <ItemBox label={t("settings.powerOffOnClose")}><Switch checked={localConfig.powerOffOnClose} onChange={(v) => dispatch(setPowerOffOnClose(v))} /></ItemBox>
          </ItemBoxContainer>
        </Section>

        <Section title={ui.advanced}>
          <ItemBoxContainer>
            <ItemBox label={t("settings.adbPath")}><Input className="w-sm" value={localConfig.adbPath} onChange={(e) => dispatch(setAdbPath(e.target.value))} /></ItemBox>
            <ItemBox label={t("settings.webBindAddr")} tooltip={t("settings.webBindAddrTip")}><AutoComplete className="w-sm" options={webBindAddrOptions} value={localConfig.webBindAddr} onChange={(v) => dispatch(setWebBindAddr(v))} /></ItemBox>
            <ItemBox label={t("settings.webPort")}><InputNumber className="w-sm" controls={false} value={localConfig.webPort} onChange={(v) => v !== null && dispatch(setWebPort(v))} /></ItemBox>
            <ItemBox label={t("settings.controllerPort")}><InputNumber className="w-sm" controls={false} value={localConfig.controllerPort} onChange={(v) => v !== null && dispatch(setControllerPort(v))} /></ItemBox>
            <ItemBox><Button type="primary" onClick={openDataPath}>{t("settings.openDataPath")}</Button></ItemBox>
          </ItemBoxContainer>
        </Section>
      </section>

      <section>
        <h2 className="title-with-line">{t("settings.about.title")}</h2>
        <Typography.Paragraph>{t("settings.about.intro")}</Typography.Paragraph>
        <Flex gap="large" wrap>
          <Button type="text" icon={<GithubFilled />} onClick={() => window.open("https://github.com/xyblue135/scrcpy-mask-enhanced-xyblue", "_blank")}>GitHub</Button>
          <Button type="text" icon={<BilibiliFilled />} onClick={() => window.open("https://space.bilibili.com/440760180", "_blank")}>BiliBili</Button>
        </Flex>
        <Flex gap="large" align="center" className="mt-4" wrap>
          <Button type="primary" icon={<CloudSyncOutlined />} onClick={checkUpdate}>{t("settings.about.checkUpdate")}</Button>
          <Badge dot={updateInfo.hasUpdate}>
            <Button type="primary" icon={<InfoCircleOutlined />} onClick={() => dispatch(setShowUpdateDialog(true))}>{t("settings.about.showUpdateDialog")}</Button>
          </Badge>
        </Flex>
        <Flex gap="large" align="center" className="mt-4" wrap>
          <Typography.Text>{t("settings.about.currentVersion")}: {updateInfo.currentVersion}</Typography.Text>
          <Typography.Text>{t("settings.about.latestVersion")}: {updateInfo.latestVersion}</Typography.Text>
        </Flex>
      </section>
      <ScrcpyModuleModal
        open={scrcpyModuleOpen}
        value={localConfig.scrcpyModule}
        onClose={() => setScrcpyModuleOpen(false)}
        onSave={(value) => dispatch(setScrcpyModule(value))}
      />
    </div>
  );
}
