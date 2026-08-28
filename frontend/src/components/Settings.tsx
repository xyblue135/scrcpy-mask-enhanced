import type { ReactNode } from "react";
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
  Switch,
  Typography,
} from "antd";
import {
  forceSetLocalConfig,
  setAdbPath,
  setClipboardSync,
  setControllerPort,
  setLanguage,
  setMappingEnabled,
  setMappingLabelOpacity,
  setMappingButtonScale,
  setTitlebarVisible,
  setWebBindAddr,
  setWebPort,
} from "../store/localConfig";
import { setIsLoading, setShowUpdateDialog, setUpdateInfo } from "../store/other";
import { requestGet } from "../utils";
import i18n, { languageOptions } from "../i18n";
import { useMessageContext } from "../hooks";
import {
  BilibiliFilled,
  CloudSyncOutlined,
  GithubFilled,
  InfoCircleOutlined,
  SyncOutlined,
} from "@ant-design/icons";

const webBindAddrOptions = [
  { value: "127.0.0.1", label: "127.0.0.1" },
  { value: "0.0.0.0", label: "0.0.0.0" },
];

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card
      size="small"
      className="mb-5"
      title={title}
      extra={subtitle ? <Typography.Text type="secondary">{subtitle}</Typography.Text> : undefined}
    >
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
        advanced: "连接 / 高级",
        enabled: "启用",
        mappingEnabled: "启用键盘映射",
        mappingEnabledTip: "关闭后停止键盘/鼠标映射；设置会保存，下次启动仍保持关闭。默认开启。",
        displayTip: "刷新键位背景直接使用 LowCast 当前正在显示的视频帧，因此虚拟屏模式会保存实际看到的虚拟屏画面。",
        windowTip: "F11 = 无边框全屏；右上角最大化 = 普通 Windows 最大化并保留任务栏。两者都保持画面宽高比。",
      }
    : {
        basic: "General / Window",
        mapping: "Keyboard Mapping",
        advanced: "Connection / Advanced",
        enabled: "Enabled",
        mappingEnabled: "Enable keyboard mapping",
        mappingEnabledTip: "Disables keyboard/mouse mappings persistently. Enabled by default.",
        displayTip: "Mapping background refresh uses the exact frame currently displayed by LowCast, including virtual displays.",
        windowTip: "F11 is borderless fullscreen; maximize keeps the Windows taskbar visible. Both preserve aspect ratio.",
      };

  async function loadLocalConfig() {
    dispatch(setIsLoading(true));
    try {
      const res = await requestGet("/api/config/get_config");
      dispatch(forceSetLocalConfig(res.data));
      i18n.changeLanguage(res.data.language);
    } catch (error: any) {
      messageApi?.error(error);
    }
    dispatch(setIsLoading(false));
  }

  async function openDataPath() {
    dispatch(setIsLoading(true));
    try {
      const res = await requestGet("/api/config/open_data_path");
      messageApi?.success(res.message);
    } catch (error: any) {
      messageApi?.error(error);
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
    } catch (error: any) {
      messageApi?.error(error);
    }
  }

  return (
    <div className="page-container">
      <section>
        <Flex align="center" justify="space-between" className="mb-4">
          <div>
            <h2 className="title-with-line" style={{ marginBottom: 4 }}>{t("settings.title.header")}</h2>
            <Typography.Text type="secondary">LowCast · Window / Mapping / Connection</Typography.Text>
          </div>
          <Button type="primary" icon={<SyncOutlined />} shape="circle" onClick={loadLocalConfig} />
        </Flex>

        <Section title={ui.basic} subtitle="Window / UI">
          <ItemBoxContainer>
            <ItemBox label={t("settings.language")}><Select className="w-sm" value={localConfig.language} options={languageOptions} onChange={(value) => dispatch(setLanguage(value))} /></ItemBox>
            <ItemBox label={t("settings.clipboardSync")}><Switch checked={localConfig.clipboardSync} onChange={(value) => dispatch(setClipboardSync(value))} /></ItemBox>
            <ItemBox label={t("settings.titlebarVisible")}><Switch checked={localConfig.titlebarVisible} onChange={(value) => dispatch(setTitlebarVisible(value))} /></ItemBox>
          </ItemBoxContainer>
          <Alert className="mt-3" type="info" showIcon message={ui.windowTip} />
        </Section>

        <Section title={ui.mapping} subtitle={localConfig.mappingEnabled ? ui.enabled : "OFF"}>
          <ItemBoxContainer>
            <ItemBox label={ui.mappingEnabled} tooltip={ui.mappingEnabledTip}><Switch checked={localConfig.mappingEnabled} onChange={(value) => dispatch(setMappingEnabled(value))} /></ItemBox>
            <ItemBox label={t("settings.mappingLabelOpacity")}><Slider style={{ width: 240 }} min={0} max={1} step={0.05} value={localConfig.mappingLabelOpacity} onChange={(value) => dispatch(setMappingLabelOpacity(value))} /></ItemBox>
            <ItemBox label={t("settings.mappingButtonScale")} tooltip={t("settings.mappingButtonScaleTip")}><Slider style={{ width: 240 }} min={0.5} max={2} step={0.05} value={localConfig.mappingButtonScale} onChange={(value) => dispatch(setMappingButtonScale(value))} /></ItemBox>
          </ItemBoxContainer>
          <Alert className="mt-3" type="info" showIcon message={ui.displayTip} />
        </Section>

        <Section title={ui.advanced}>
          <ItemBoxContainer>
            <ItemBox label={t("settings.adbPath")}><Input className="w-sm" value={localConfig.adbPath} onChange={(event) => dispatch(setAdbPath(event.target.value))} /></ItemBox>
            <ItemBox label={t("settings.webBindAddr")} tooltip={t("settings.webBindAddrTip")}><AutoComplete className="w-sm" options={webBindAddrOptions} value={localConfig.webBindAddr} onChange={(value) => dispatch(setWebBindAddr(value))} /></ItemBox>
            <ItemBox label={t("settings.webPort")}><InputNumber className="w-sm" controls={false} value={localConfig.webPort} onChange={(value) => value !== null && dispatch(setWebPort(value))} /></ItemBox>
            <ItemBox label={t("settings.controllerPort")}><InputNumber className="w-sm" controls={false} value={localConfig.controllerPort} onChange={(value) => value !== null && dispatch(setControllerPort(value))} /></ItemBox>
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
          <Badge dot={updateInfo.hasUpdate}><Button type="primary" icon={<InfoCircleOutlined />} onClick={() => dispatch(setShowUpdateDialog(true))}>{t("settings.about.showUpdateDialog")}</Button></Badge>
        </Flex>
        <Flex gap="large" align="center" className="mt-4" wrap>
          <Typography.Text>{t("settings.about.currentVersion")}: {updateInfo.currentVersion}</Typography.Text>
          <Typography.Text>{t("settings.about.latestVersion")}: {updateInfo.latestVersion}</Typography.Text>
        </Flex>
      </section>
    </div>
  );
}
