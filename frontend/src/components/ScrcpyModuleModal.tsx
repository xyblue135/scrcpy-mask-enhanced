import {
  Button,
  Card,
  Collapse,
  Divider,
  Flex,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { CopyOutlined, DeleteOutlined, MobileOutlined, PlusOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import {
  defaultScrcpyVirtualDisplay,
  setScrcpyModule,
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
import { useAppDispatch, useAppSelector } from "../store/store";
import { useMessageContext } from "../hooks";

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

function commandTokens(command: string) {
  const tokens: string[] = [];
  const pattern = /"((?:\\.|[^"\\])*)"|'([^']*)'|([^\s]+)/g;
  for (const match of command.matchAll(pattern)) {
    tokens.push((match[1] ?? match[2] ?? match[3]).replaceAll('\\"', '"'));
  }
  return tokens;
}

function parseBoolean(value: string) {
  return !["false", "0", "no", "off"].includes(value.toLowerCase());
}

function normalizeBitRate(key: string, value: string) {
  if (key !== "video_bit_rate" && key !== "audio_bit_rate") return value;
  const match = value.match(/^(\d+(?:\.\d+)?)([kmg])$/i);
  if (!match) return value;
  const multiplier = { k: 1_000, m: 1_000_000, g: 1_000_000_000 }[
    match[2].toLowerCase() as "k" | "m" | "g"
  ];
  return String(Math.round(Number(match[1]) * multiplier));
}

function parseCommandIntoPreset(command: string, current: ScrcpyPreset): ScrcpyPreset {
  const parsed = withCompleteScrcpyOptions({
    ...current,
    video: true,
    audio: true,
    virtualDisplay: defaultScrcpyVirtualDisplay(),
    parameters: [],
  });
  const parameters = parsed.parameters.map((parameter) => ({ ...parameter, enabled: false }));
  const tokens = commandTokens(command.trim());

  for (let index = 0; index < tokens.length; index += 1) {
    const rawToken = tokens[index];
    if (!rawToken.startsWith("--")) continue;
    const token = rawToken.slice(2);
    const equalIndex = token.indexOf("=");
    const rawKey = equalIndex >= 0 ? token.slice(0, equalIndex) : token;
    const followingToken = tokens[index + 1];
    const hasSeparateValue = equalIndex < 0 && followingToken !== undefined
      && (!followingToken.startsWith("-") || /^-\d/.test(followingToken));
    let value = equalIndex >= 0
      ? token.slice(equalIndex + 1)
      : hasSeparateValue
        ? followingToken
        : "true";
    if (hasSeparateValue) index += 1;
    const negated = rawKey.startsWith("no-");
    const cliKey = negated ? rawKey.slice(3) : rawKey;
    const key = cliKey.replaceAll("-", "_").toLowerCase();
    if (negated) value = "false";

    if (key === "video") {
      parsed.video = parseBoolean(value);
      continue;
    }
    if (key === "audio") {
      parsed.audio = parseBoolean(value);
      continue;
    }
    if (key === "new_display") {
      parsed.virtualDisplay.enabled = parseBoolean(value);
      if (value !== "true" && value !== "false" && value !== "") {
        const size = value.match(/^(\d+)x(\d+)(?:\/(\d+))?$/);
        if (!size) throw new Error(`无法解析虚拟屏尺寸：${value}`);
        parsed.virtualDisplay.useMainSize = false;
        parsed.virtualDisplay.width = Number(size[1]);
        parsed.virtualDisplay.height = Number(size[2]);
        if (size[3]) parsed.virtualDisplay.dpi = Number(size[3]);
      }
      continue;
    }
    if (key === "keep_active") {
      parsed.virtualDisplay.keepActive = parseBoolean(value);
      continue;
    }
    if (key === "vd_destroy_content") {
      parsed.virtualDisplay.destroyContent = parseBoolean(value);
      continue;
    }
    if (key === "vd_system_decorations") {
      parsed.virtualDisplay.systemDecorations = parseBoolean(value);
      continue;
    }
    if (key === "start_app") {
      parsed.virtualDisplay.enabled = true;
      parsed.virtualDisplay.startAppEnabled = true;
      parsed.virtualDisplay.startAppForceStop = value.startsWith("+");
      parsed.virtualDisplay.startAppPackage = value.replace(/^\+/, "");
      continue;
    }

    const definition = SCRCPY_OPTION_BY_KEY.get(key);
    const normalizedValue = normalizeBitRate(key, value);
    const existing = parameters.find((parameter) => parameter.key === key);
    if (existing) {
      existing.enabled = true;
      existing.value = normalizedValue;
      existing.scope = definition?.scope ?? existing.scope;
    } else {
      parameters.push({
        id: id("parameter"),
        enabled: true,
        key,
        value: normalizedValue,
        scope: definition?.scope ?? "clientOnly",
      });
    }
  }

  parsed.parameters = parameters;
  return parsed;
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

export default function ScrcpyModulePage() {
  const dispatch = useAppDispatch();
  const messageApi = useMessageContext();
  const value = useAppSelector((state) => state.localConfig.scrcpyModule);
  const [draft, setDraft] = useState<ScrcpyModuleConfig>(() => normalizeModule(value));
  const controlledDevices = useAppSelector((state) => state.other.controlledDevices);
  const [commandDraft, setCommandDraft] = useState("");

  useEffect(() => {
    setDraft(normalizeModule(value));
  }, [value]);

  const activeIndex = Math.max(0, draft.presets.findIndex((preset) => preset.id === draft.activePresetId));
  const activePreset = draft.presets[activeIndex];
  const generatedCommand = useMemo(
    () => (draft.enabled && activePreset ? commandPreview(activePreset) : "scrcpy"),
    [activePreset, draft.enabled],
  );

  useEffect(() => {
    setCommandDraft(generatedCommand);
  }, [generatedCommand]);

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

  const [commandHistory, setCommandHistory] = useState<string[]>([]);

  function updateParameter(parameterId: string, patch: Partial<ScrcpyParameter>) {
    updateActive((preset) => ({
      ...preset,
      parameters: preset.parameters.map((parameter) => parameter.id === parameterId ? { ...parameter, ...patch } : parameter),
    }));
  }

  function deleteParameter(parameterId: string) {
    updateActive((preset) => ({ ...preset, parameters: preset.parameters.filter((parameter) => parameter.id !== parameterId) }));
  }

  function applyCommand() {
    if (!activePreset) return;
    try {
      const parsed = parseCommandIntoPreset(commandDraft, activePreset);
      setDraft((current) => ({
        ...current,
        enabled: true,
        presets: current.presets.map((preset, index) => index === activeIndex ? parsed : preset),
      }));
      setCommandDraft(commandPreview(parsed));
      messageApi?.success("命令已解析到当前预设");
    } catch (error) {
      messageApi?.error(error instanceof Error ? error.message : String(error));
    }
  }

  function save(enabled = draft.enabled) {
    dispatch(setScrcpyModule({ ...draft, enabled }));
    messageApi?.success(enabled ? "scrcpy 预设已保存并启用" : "scrcpy 预设已保存");
  }

  const customParameters = activePreset?.parameters.filter((parameter) => !SCRCPY_OPTION_BY_KEY.has(parameter.key)) ?? [];
  const parameterPanels = [
    {
      key: "media",
      label: "媒体通道",
      children: (
        <Flex gap="middle" align="center" wrap>
          <Space><Typography.Text>视频</Typography.Text><Switch checked={activePreset?.video ?? false} onChange={(video) => activePreset && updateActive((preset) => ({ ...preset, video }))} /></Space>
          <Space><Typography.Text>音频</Typography.Text><Switch checked={activePreset?.audio ?? false} onChange={(audio) => activePreset && updateActive((preset) => ({ ...preset, audio }))} /></Space>
        </Flex>
      ),
    },
    {
      key: "virtual",
      label: "虚拟屏幕与应用启动",
      children: (
        <Flex vertical gap="small">
          <Flex gap="middle" align="center" wrap>
            <Space><Typography.Text>启用虚拟屏</Typography.Text><Switch checked={activePreset?.virtualDisplay.enabled ?? false} onChange={(enabled) => activePreset && updateVirtualDisplay({ enabled })} /></Space>
            <Space><Typography.Text>跟随主屏尺寸</Typography.Text><Switch disabled={!activePreset?.virtualDisplay.enabled} checked={activePreset?.virtualDisplay.useMainSize ?? false} onChange={(useMainSize) => activePreset && updateVirtualDisplay({ useMainSize })} /></Space>
            <Space><Typography.Text>保持活动</Typography.Text><Switch disabled={!activePreset?.virtualDisplay.enabled} checked={activePreset?.virtualDisplay.keepActive ?? false} onChange={(keepActive) => activePreset && updateVirtualDisplay({ keepActive })} /></Space>
            <Space><Typography.Text>销毁内容</Typography.Text><Switch disabled={!activePreset?.virtualDisplay.enabled} checked={activePreset?.virtualDisplay.destroyContent ?? false} onChange={(destroyContent) => activePreset && updateVirtualDisplay({ destroyContent })} /></Space>
            <Space><Typography.Text>系统装饰</Typography.Text><Switch disabled={!activePreset?.virtualDisplay.enabled} checked={activePreset?.virtualDisplay.systemDecorations ?? false} onChange={(systemDecorations) => activePreset && updateVirtualDisplay({ systemDecorations })} /></Space>
          </Flex>
          <Flex gap="small" align="center" wrap>
            <InputNumber addonBefore="宽" min={1} max={16384} disabled={!activePreset?.virtualDisplay.enabled || activePreset?.virtualDisplay.useMainSize} value={activePreset?.virtualDisplay.width} onChange={(width) => width !== null && activePreset && updateVirtualDisplay({ width })} />
            <InputNumber addonBefore="高" min={1} max={16384} disabled={!activePreset?.virtualDisplay.enabled || activePreset?.virtualDisplay.useMainSize} value={activePreset?.virtualDisplay.height} onChange={(height) => height !== null && activePreset && updateVirtualDisplay({ height })} />
            <InputNumber addonBefore="DPI" min={1} max={2000} disabled={!activePreset?.virtualDisplay.enabled || activePreset?.virtualDisplay.useMainSize} value={activePreset?.virtualDisplay.dpi} onChange={(dpi) => dpi !== null && activePreset && updateVirtualDisplay({ dpi })} />
          <Button
            size="small"
            icon={<MobileOutlined />}
            disabled={!activePreset?.virtualDisplay.enabled || activePreset?.virtualDisplay.useMainSize || controlledDevices.length === 0}
            onClick={() => {
              const main = controlledDevices.find((d) => d.main);
              if (main) {
                updateVirtualDisplay({ width: main.device_size[0], height: main.device_size[1], dpi: main.device_dpi });
              }
            }}
          >
            使用手机分辨率
          </Button>
          </Flex>
          <Flex gap="small" align="center" wrap>
            <Space><Typography.Text>启动指定应用</Typography.Text><Switch disabled={!activePreset?.virtualDisplay.enabled} checked={activePreset?.virtualDisplay.startAppEnabled ?? false} onChange={(startAppEnabled) => activePreset && updateVirtualDisplay({ startAppEnabled })} /></Space>
            <Input style={{ width: 330 }} placeholder="com.example.game" disabled={!activePreset?.virtualDisplay.enabled || !activePreset?.virtualDisplay.startAppEnabled} value={activePreset?.virtualDisplay.startAppPackage} onChange={(event) => activePreset && updateVirtualDisplay({ startAppPackage: event.target.value })} />
            <Space><Typography.Text>启动前强制停止</Typography.Text><Switch disabled={!activePreset?.virtualDisplay.enabled || !activePreset?.virtualDisplay.startAppEnabled} checked={activePreset?.virtualDisplay.startAppForceStop ?? false} onChange={(startAppForceStop) => activePreset && updateVirtualDisplay({ startAppForceStop })} /></Space>
          </Flex>
        </Flex>
      ),
    },
    ...SCRCPY_OPTION_GROUPS.map((group) => {
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
  }),
];

  return (
    <div className="page-container">
      <Flex justify="space-between" align="center" gap="middle" wrap className="mb-4">
        <h2 className="title-with-line" style={{ marginBottom: 0 }}>Scrcpy 预设</h2>
        <Space>
          <Button type="primary" onClick={() => save()}>保存</Button>
        </Space>
      </Flex>

      <Flex className="mt-4" gap="middle" align="center" wrap>
        <Typography.Text strong>启用参数模块</Typography.Text>
        <Switch checked={draft.enabled} onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))} />
        <Typography.Text type="secondary">
          {draft.enabled ? "当前预设会在下次连接时应用" : "已关闭：使用 scrcpy 默认值，不附加可选调试参数"}
        </Typography.Text>
        <Select style={{ minWidth: 280 }} value={draft.activePresetId} options={draft.presets.map((preset) => ({ value: preset.id, label: preset.name }))} onChange={(activePresetId) => setDraft((current) => ({ ...current, activePresetId }))} />
        <Button icon={<PlusOutlined />} onClick={addPreset}>新建</Button>
        <Button icon={<CopyOutlined />} onClick={duplicatePreset}>复制</Button>
        <Popconfirm title="删除当前预设？" disabled={draft.presets.length <= 1} onConfirm={deletePreset}>
          <Button danger icon={<DeleteOutlined />} disabled={draft.presets.length <= 1}>删除</Button>
        </Popconfirm>
      </Flex>

      {activePreset && (
        <>
          <Collapse className="mt-3" items={parameterPanels} defaultActiveKey={[]} />

          {customParameters.length > 0 && (
            <Collapse className="mt-3" items={[{ key: "custom", label: "自定义参数", children: <Space direction="vertical" size="small" style={{ width: "100%" }}>
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
            </Space> }]} defaultActiveKey={[]} />
          )}

          <Divider orientation="left">命令编辑 / 预览</Divider>
          <Input.TextArea
            value={commandDraft}
            autoSize={{ minRows: 3, maxRows: 8 }}
            placeholder="可直接粘贴 scrcpy --video-codec=h265 ..."
            onChange={(event) => {
              setCommandDraft(event.target.value);
              setCommandHistory((prev) => [...prev, event.target.value]);
            }}
          />
          <Flex className="mt-2" gap="small" wrap>
            <Button type="primary" onClick={applyCommand}>解析命令到当前预设</Button>
            <Button
              disabled={commandHistory.length < 2}
              onClick={() => {
                const prev = commandHistory.slice(0, -1);
                setCommandHistory(prev);
                setCommandDraft(prev[prev.length - 1] ?? generatedCommand);
              }}
            >
              撤销
            </Button>
          </Flex>
        </>
      )}
    </div>
  );
}
