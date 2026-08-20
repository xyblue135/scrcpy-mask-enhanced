import {
  Alert,
  Button,
  Card,
  Collapse,
  Divider,
  Flex,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { CopyOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import {
  defaultScrcpyVirtualDisplay,
  qualcommHevcLowLatencyPreset,
  type ScrcpyModuleConfig,
  type ScrcpyParameter,
  type ScrcpyPreset,
  type ScrcpyVirtualDisplayConfig,
} from "../store/localConfig";
import {
  SCRCPY_OPTION_BY_KEY,
  SCRCPY_OPTION_GROUPS,
  SCRCPY_OPTIONS,
  withCompleteScrcpyOptions,
  type ScrcpyOptionDefinition,
} from "../scrcpyOptions";

interface Props {
  open: boolean;
  value: ScrcpyModuleConfig;
  onClose: () => void;
  onSave: (value: ScrcpyModuleConfig) => void;
}

function cloneModule(value: ScrcpyModuleConfig): ScrcpyModuleConfig {
  return JSON.parse(JSON.stringify(value)) as ScrcpyModuleConfig;
}

function normalizeModule(value: ScrcpyModuleConfig): ScrcpyModuleConfig {
  const cloned = cloneModule(value);
  return {
    ...cloned,
    presets: cloned.presets.map((preset) =>
      withCompleteScrcpyOptions({
        ...preset,
        virtualDisplay: preset.virtualDisplay ?? defaultScrcpyVirtualDisplay(),
      }),
    ),
  };
}

function id(prefix: string) {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "");
  return `${prefix}-${random ?? `${Date.now()}${Math.random().toString(16).slice(2)}`}`;
}

function cliOption(parameter: ScrcpyParameter) {
  const key = parameter.key.trim().replace(/^--/, "").replaceAll("_", "-");
  return parameter.value === "" ? `--${key}` : `--${key}=${parameter.value}`;
}

function commandPreview(preset: ScrcpyPreset) {
  const args = preset.parameters.filter((parameter) => parameter.enabled).map(cliOption);
  if (!preset.video) args.unshift("--no-video");
  if (!preset.audio) args.push("--no-audio");

  const display = preset.virtualDisplay;
  if (display.enabled) {
    args.push(display.useMainSize ? "--new-display" : `--new-display=${display.width}x${display.height}/${display.dpi}`);
    args.push(`--keep-active=${display.keepActive}`);
    args.push(`--vd-destroy-content=${display.destroyContent}`);
    args.push(`--vd-system-decorations=${display.systemDecorations}`);
    if (display.startAppEnabled && display.startAppPackage.trim()) {
      args.push(`--start-app=${display.startAppForceStop ? "+" : ""}${display.startAppPackage.trim()}`);
    }
  }
  return `scrcpy ${args.join(" ")}`;
}

function OfficialParameterRow({ parameter, definition, onChange }: {
  parameter: ScrcpyParameter;
  definition: ScrcpyOptionDefinition;
  onChange: (patch: Partial<ScrcpyParameter>) => void;
}) {
  const valueEditor = definition.choices ? (
    <Select
      style={{ flex: "1 1 260px" }}
      value={parameter.value}
      options={definition.choices.map((value) => ({ value, label: value || "（空 / 自动）" }))}
      onChange={(value) => onChange({ value })}
    />
  ) : (
    <Input
      style={{ flex: "1 1 260px" }}
      value={parameter.value}
      placeholder={definition.defaultValue || "留空使用默认值"}
      onChange={(event) => onChange({ value: event.target.value })}
    />
  );

  return (
    <Flex gap="small" align="center" wrap style={{ padding: "8px 0" }}>
      <Switch checked={parameter.enabled} onChange={(enabled) => onChange({ enabled })} />
      <Tooltip title={definition.description}>
        <Typography.Text style={{ width: 175 }}>{definition.label}</Typography.Text>
      </Tooltip>
      <Typography.Text code style={{ width: 185 }}>{definition.key}</Typography.Text>
      {valueEditor}
      <Tag color={definition.scope === "server" ? "blue" : "gold"}>
        {definition.scope === "server" ? "Server" : "Client Only"}
      </Tag>
    </Flex>
  );
}

export default function ScrcpyModuleModal({ open, value, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<ScrcpyModuleConfig>(() => normalizeModule(value));

  useEffect(() => {
    if (open) setDraft(normalizeModule(value));
  }, [open, value]);

  const activeIndex = Math.max(0, draft.presets.findIndex((preset) => preset.id === draft.activePresetId));
  const activePreset = draft.presets[activeIndex];
  const preview = useMemo(() => (activePreset ? commandPreview(activePreset) : "scrcpy"), [activePreset]);

  function updateActive(update: (preset: ScrcpyPreset) => ScrcpyPreset) {
    setDraft((current) => ({
      ...current,
      presets: current.presets.map((preset, index) => index === activeIndex ? update(preset) : preset),
    }));
  }

  function updateVirtualDisplay(patch: Partial<ScrcpyVirtualDisplayConfig>) {
    updateActive((preset) => ({ ...preset, virtualDisplay: { ...preset.virtualDisplay, ...patch } }));
  }

  function addPreset() {
    const preset = withCompleteScrcpyOptions({
      id: id("preset"),
      name: "新 scrcpy 预设",
      video: true,
      audio: true,
      virtualDisplay: defaultScrcpyVirtualDisplay(),
      parameters: [],
    });
    setDraft((current) => ({ ...current, activePresetId: preset.id, presets: [...current.presets, preset] }));
  }

  function duplicatePreset() {
    if (!activePreset) return;
    const copy: ScrcpyPreset = {
      ...cloneModule({ enabled: false, activePresetId: activePreset.id, presets: [activePreset] }).presets[0],
      id: id("preset"),
      name: `${activePreset.name} 副本`,
      parameters: activePreset.parameters.map((parameter) => ({ ...parameter, id: id("parameter") })),
    };
    setDraft((current) => ({ ...current, activePresetId: copy.id, presets: [...current.presets, copy] }));
  }

  function deletePreset() {
    if (draft.presets.length <= 1 || !activePreset) return;
    const presets = draft.presets.filter((preset) => preset.id !== activePreset.id);
    setDraft((current) => ({ ...current, activePresetId: presets[0].id, presets }));
  }

  function loadQualcommPreset() {
    const sample = withCompleteScrcpyOptions(qualcommHevcLowLatencyPreset());
    updateActive((preset) => ({
      ...sample,
      id: preset.id,
      parameters: sample.parameters.map((parameter) => ({ ...parameter, id: id("parameter") })),
    }));
  }

  function addParameter() {
    updateActive((preset) => ({
      ...preset,
      parameters: [...preset.parameters, { id: id("parameter"), enabled: true, key: "custom_option", value: "", scope: "server" }],
    }));
  }

  function updateParameter(parameterId: string, patch: Partial<ScrcpyParameter>) {
    updateActive((preset) => ({
      ...preset,
      parameters: preset.parameters.map((parameter) => parameter.id === parameterId ? { ...parameter, ...patch } : parameter),
    }));
  }

  function deleteParameter(parameterId: string) {
    updateActive((preset) => ({ ...preset, parameters: preset.parameters.filter((parameter) => parameter.id !== parameterId) }));
  }

  function save(enabled = draft.enabled) {
    onSave({ ...draft, enabled });
    onClose();
  }

  const customParameters = activePreset?.parameters.filter((parameter) => !SCRCPY_OPTION_BY_KEY.has(parameter.key)) ?? [];
  const parameterPanels = SCRCPY_OPTION_GROUPS.map((group) => {
    const definitions = SCRCPY_OPTIONS.filter((definition) => definition.group === group.key);
    const enabledCount = definitions.filter((definition) => activePreset?.parameters.some((parameter) => parameter.key === definition.key && parameter.enabled)).length;
    return {
      key: group.key,
      label: `${group.label}（启用 ${enabledCount}/${definitions.length}）`,
      children: (
        <div>
          {definitions.map((definition) => {
            const parameter = activePreset?.parameters.find((candidate) => candidate.key === definition.key);
            if (!parameter) return null;
            return <OfficialParameterRow key={parameter.id} parameter={parameter} definition={definition} onChange={(patch) => updateParameter(parameter.id, patch)} />;
          })}
        </div>
      ),
    };
  });

  return (
    <Modal
      title="关于 scrcpy / 完整参数调试中心"
      open={open}
      onCancel={onClose}
      width={1080}
      destroyOnHidden
      styles={{ body: { maxHeight: "68vh", overflowY: "auto", paddingRight: 8 } }}
      footer={[
        <Button key="cancel" onClick={onClose}>取消</Button>,
        <Button key="save" onClick={() => save()}>保存</Button>,
        <Button key="enable" type="primary" onClick={() => save(true)}>保存并启用此预设</Button>,
      ]}
    >
      <Alert showIcon type="info" message="参数以 scrcpy 4.0 server Options.java 为基线。Server 参数真实应用；Client Only 仅用于记录官方 scrcpy.exe 参数。连接标识、传输元数据和控制通道由 LowCast 管理，避免调试时破坏协议。" />

      <Flex className="mt-4" gap="middle" align="center" wrap>
        <Typography.Text strong>启用参数模块</Typography.Text>
        <Switch checked={draft.enabled} onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))} />
        <Select style={{ minWidth: 280 }} value={draft.activePresetId} options={draft.presets.map((preset) => ({ value: preset.id, label: preset.name }))} onChange={(activePresetId) => setDraft((current) => ({ ...current, activePresetId }))} />
        <Button icon={<PlusOutlined />} onClick={addPreset}>新建</Button>
        <Button icon={<CopyOutlined />} onClick={duplicatePreset}>复制</Button>
        <Popconfirm title="删除当前预设？" disabled={draft.presets.length <= 1} onConfirm={deletePreset}>
          <Button danger icon={<DeleteOutlined />} disabled={draft.presets.length <= 1}>删除</Button>
        </Popconfirm>
      </Flex>

      {activePreset && (
        <>
          <Card className="mt-4" size="small" title="预设与媒体通道">
            <Flex gap="large" align="center" wrap>
              <Input style={{ width: 300 }} addonBefore="名称" value={activePreset.name} onChange={(event) => updateActive((preset) => ({ ...preset, name: event.target.value }))} />
              <Space><Typography.Text>视频</Typography.Text><Switch checked={activePreset.video} onChange={(video) => updateActive((preset) => ({ ...preset, video }))} /></Space>
              <Space><Typography.Text>音频</Typography.Text><Switch checked={activePreset.audio} onChange={(audio) => updateActive((preset) => ({ ...preset, audio }))} /></Space>
              <Button onClick={loadQualcommPreset}>载入 Qualcomm H.265 示例</Button>
            </Flex>
          </Card>

          <Card className="mt-3" size="small" title="虚拟屏幕与应用启动">
            <Flex gap="large" align="center" wrap>
              <Space><Typography.Text>启用虚拟屏</Typography.Text><Switch checked={activePreset.virtualDisplay.enabled} onChange={(enabled) => updateVirtualDisplay({ enabled })} /></Space>
              <Space><Typography.Text>跟随主屏尺寸</Typography.Text><Switch disabled={!activePreset.virtualDisplay.enabled} checked={activePreset.virtualDisplay.useMainSize} onChange={(useMainSize) => updateVirtualDisplay({ useMainSize })} /></Space>
              <Space><Typography.Text>保持活动</Typography.Text><Switch disabled={!activePreset.virtualDisplay.enabled} checked={activePreset.virtualDisplay.keepActive} onChange={(keepActive) => updateVirtualDisplay({ keepActive })} /></Space>
              <Space><Typography.Text>销毁内容</Typography.Text><Switch disabled={!activePreset.virtualDisplay.enabled} checked={activePreset.virtualDisplay.destroyContent} onChange={(destroyContent) => updateVirtualDisplay({ destroyContent })} /></Space>
              <Space><Typography.Text>系统装饰</Typography.Text><Switch disabled={!activePreset.virtualDisplay.enabled} checked={activePreset.virtualDisplay.systemDecorations} onChange={(systemDecorations) => updateVirtualDisplay({ systemDecorations })} /></Space>
            </Flex>
            <Flex className="mt-3" gap="small" align="center" wrap>
              <InputNumber addonBefore="宽" min={1} max={16384} disabled={!activePreset.virtualDisplay.enabled || activePreset.virtualDisplay.useMainSize} value={activePreset.virtualDisplay.width} onChange={(width) => width !== null && updateVirtualDisplay({ width })} />
              <InputNumber addonBefore="高" min={1} max={16384} disabled={!activePreset.virtualDisplay.enabled || activePreset.virtualDisplay.useMainSize} value={activePreset.virtualDisplay.height} onChange={(height) => height !== null && updateVirtualDisplay({ height })} />
              <InputNumber addonBefore="DPI" min={1} max={2000} disabled={!activePreset.virtualDisplay.enabled || activePreset.virtualDisplay.useMainSize} value={activePreset.virtualDisplay.dpi} onChange={(dpi) => dpi !== null && updateVirtualDisplay({ dpi })} />
            </Flex>
            <Flex className="mt-3" gap="small" align="center" wrap>
              <Space><Typography.Text>启动指定应用</Typography.Text><Switch disabled={!activePreset.virtualDisplay.enabled} checked={activePreset.virtualDisplay.startAppEnabled} onChange={(startAppEnabled) => updateVirtualDisplay({ startAppEnabled })} /></Space>
              <Input style={{ width: 330 }} placeholder="com.example.game" disabled={!activePreset.virtualDisplay.enabled || !activePreset.virtualDisplay.startAppEnabled} value={activePreset.virtualDisplay.startAppPackage} onChange={(event) => updateVirtualDisplay({ startAppPackage: event.target.value })} />
              <Space><Typography.Text>启动前强制停止</Typography.Text><Switch disabled={!activePreset.virtualDisplay.enabled || !activePreset.virtualDisplay.startAppEnabled} checked={activePreset.virtualDisplay.startAppForceStop} onChange={(startAppForceStop) => updateVirtualDisplay({ startAppForceStop })} /></Space>
            </Flex>
          </Card>

          <Divider orientation="left">scrcpy 4.0 参数目录</Divider>
          <Collapse items={parameterPanels} defaultActiveKey={["video", "display"]} />

          <Divider orientation="left">自定义参数</Divider>
          <Space direction="vertical" size="small" style={{ width: "100%" }}>
            {customParameters.map((parameter) => (
              <Card key={parameter.id} size="small">
                <Flex gap="small" align="center" wrap>
                  <Switch checked={parameter.enabled} onChange={(enabled) => updateParameter(parameter.id, { enabled })} />
                  <Select style={{ width: 135 }} value={parameter.scope} options={[{ value: "server", label: "Server 参数" }, { value: "clientOnly", label: "Client Only" }]} onChange={(scope) => updateParameter(parameter.id, { scope })} />
                  <Input style={{ flex: "1 1 220px" }} addonBefore="--" value={parameter.key} placeholder="custom_option" onChange={(event) => updateParameter(parameter.id, { key: event.target.value })} />
                  <Input style={{ flex: "1 1 260px" }} addonBefore="=" value={parameter.value} placeholder="value" onChange={(event) => updateParameter(parameter.id, { value: event.target.value })} />
                  <Button danger type="text" icon={<DeleteOutlined />} onClick={() => deleteParameter(parameter.id)} />
                </Flex>
              </Card>
            ))}
            <Button block type="dashed" icon={<PlusOutlined />} onClick={addParameter}>添加自定义参数</Button>
          </Space>

          <Divider orientation="left">命令预览</Divider>
          <Typography.Paragraph copyable={{ text: preview }}><Typography.Text code>{preview}</Typography.Text></Typography.Paragraph>
          <Space wrap>
            <Tag color="blue">Server 参数会真实应用</Tag>
            <Tag color="purple">虚拟屏与应用启动属于当前预设</Tag>
            <Tag color="gold">Client Only 不会传给 Android</Tag>
            <Tag color="green">下次连接或重新连接生效</Tag>
          </Space>
        </>
      )}
    </Modal>
  );
}
