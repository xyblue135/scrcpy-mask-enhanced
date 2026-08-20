import {
  Alert,
  Button,
  Card,
  Divider,
  Flex,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import { CopyOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import {
  qualcommHevcLowLatencyPreset,
  type ScrcpyModuleConfig,
  type ScrcpyParameter,
  type ScrcpyPreset,
} from "../store/localConfig";

interface Props {
  open: boolean;
  value: ScrcpyModuleConfig;
  onClose: () => void;
  onSave: (value: ScrcpyModuleConfig) => void;
}

function cloneModule(value: ScrcpyModuleConfig): ScrcpyModuleConfig {
  return JSON.parse(JSON.stringify(value)) as ScrcpyModuleConfig;
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
  const args = preset.parameters
    .filter((parameter) => parameter.enabled)
    .map(cliOption);
  if (!preset.video) args.unshift("--no-video");
  if (!preset.audio) args.push("--no-audio");
  return `scrcpy ${args.join(" ")}`;
}

export default function ScrcpyModuleModal({ open, value, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<ScrcpyModuleConfig>(() => cloneModule(value));

  useEffect(() => {
    if (open) setDraft(cloneModule(value));
  }, [open, value]);

  const activeIndex = Math.max(
    0,
    draft.presets.findIndex((preset) => preset.id === draft.activePresetId),
  );
  const activePreset = draft.presets[activeIndex];
  const preview = useMemo(
    () => (activePreset ? commandPreview(activePreset) : "scrcpy"),
    [activePreset],
  );

  function updateActive(update: (preset: ScrcpyPreset) => ScrcpyPreset) {
    setDraft((current) => ({
      ...current,
      presets: current.presets.map((preset, index) =>
        index === activeIndex ? update(preset) : preset,
      ),
    }));
  }

  function addPreset() {
    const preset: ScrcpyPreset = {
      id: id("preset"),
      name: "新 scrcpy 预设",
      video: true,
      audio: true,
      parameters: [],
    };
    setDraft((current) => ({
      ...current,
      activePresetId: preset.id,
      presets: [...current.presets, preset],
    }));
  }

  function duplicatePreset() {
    if (!activePreset) return;
    const copy: ScrcpyPreset = {
      ...cloneModule({ enabled: false, activePresetId: activePreset.id, presets: [activePreset] })
        .presets[0],
      id: id("preset"),
      name: `${activePreset.name} 副本`,
      parameters: activePreset.parameters.map((parameter) => ({
        ...parameter,
        id: id("parameter"),
      })),
    };
    setDraft((current) => ({
      ...current,
      activePresetId: copy.id,
      presets: [...current.presets, copy],
    }));
  }

  function deletePreset() {
    if (draft.presets.length <= 1 || !activePreset) return;
    const presets = draft.presets.filter((preset) => preset.id !== activePreset.id);
    setDraft((current) => ({
      ...current,
      activePresetId: presets[0].id,
      presets,
    }));
  }

  function loadQualcommPreset() {
    const sample = qualcommHevcLowLatencyPreset();
    updateActive((preset) => ({
      ...sample,
      id: preset.id,
      parameters: sample.parameters.map((parameter) => ({
        ...parameter,
        id: id("parameter"),
      })),
    }));
  }

  function addParameter() {
    updateActive((preset) => ({
      ...preset,
      parameters: [
        ...preset.parameters,
        {
          id: id("parameter"),
          enabled: true,
          key: "custom_option",
          value: "",
          scope: "server",
        },
      ],
    }));
  }

  function updateParameter(parameterId: string, patch: Partial<ScrcpyParameter>) {
    updateActive((preset) => ({
      ...preset,
      parameters: preset.parameters.map((parameter) =>
        parameter.id === parameterId ? { ...parameter, ...patch } : parameter,
      ),
    }));
  }

  function deleteParameter(parameterId: string) {
    updateActive((preset) => ({
      ...preset,
      parameters: preset.parameters.filter((parameter) => parameter.id !== parameterId),
    }));
  }

  function save(enabled = draft.enabled) {
    onSave({ ...draft, enabled });
    onClose();
  }

  return (
    <Modal
      title="关于 scrcpy / 参数预设"
      open={open}
      onCancel={onClose}
      width={980}
      destroyOnHidden
      styles={{ body: { maxHeight: "68vh", overflowY: "auto", paddingRight: 8 } }}
      footer={[
        <Button key="cancel" onClick={onClose}>取消</Button>,
        <Button key="save" onClick={() => save()}>保存</Button>,
        <Button key="enable" type="primary" onClick={() => save(true)}>
          保存并启用此预设
        </Button>,
      ]}
    >
      <Alert
        showIcon
        type="info"
        message="LowCast 直接启动 Android scrcpy server；Server 参数会真实应用，Client Only 参数只出现在命令预览中。video_buffer=0 不会传给 Android，因为 LowCast 已使用 latest-frame-only 渲染管线。"
      />

      <Flex className="mt-4" gap="middle" align="center" wrap>
        <Typography.Text strong>启用参数模块</Typography.Text>
        <Switch
          checked={draft.enabled}
          onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
        />
        <Select
          style={{ minWidth: 260 }}
          value={draft.activePresetId}
          options={draft.presets.map((preset) => ({ value: preset.id, label: preset.name }))}
          onChange={(activePresetId) =>
            setDraft((current) => ({ ...current, activePresetId }))
          }
        />
        <Button icon={<PlusOutlined />} onClick={addPreset}>新建</Button>
        <Button icon={<CopyOutlined />} onClick={duplicatePreset}>复制</Button>
        <Popconfirm
          title="删除当前预设？"
          disabled={draft.presets.length <= 1}
          onConfirm={deletePreset}
        >
          <Button
            danger
            icon={<DeleteOutlined />}
            disabled={draft.presets.length <= 1}
          >
            删除
          </Button>
        </Popconfirm>
      </Flex>

      {activePreset && (
        <>
          <Card className="mt-4" size="small" title="预设行为">
            <Flex gap="large" align="center" wrap>
              <Input
                style={{ width: 300 }}
                addonBefore="名称"
                value={activePreset.name}
                onChange={(event) =>
                  updateActive((preset) => ({ ...preset, name: event.target.value }))
                }
              />
              <Space>
                <Typography.Text>视频</Typography.Text>
                <Switch
                  checked={activePreset.video}
                  onChange={(video) => updateActive((preset) => ({ ...preset, video }))}
              />
              </Space>
              <Space>
                <Typography.Text>音频</Typography.Text>
                <Switch
                  checked={activePreset.audio}
                  onChange={(audio) => updateActive((preset) => ({ ...preset, audio }))}
                />
              </Space>
              <Button onClick={loadQualcommPreset}>载入 Qualcomm H.265 示例</Button>
            </Flex>
          </Card>

          <Divider orientation="left">参数</Divider>
          <Space direction="vertical" size="small" style={{ width: "100%" }}>
            {activePreset.parameters.map((parameter) => (
              <Card key={parameter.id} size="small">
                <Flex gap="small" align="center" wrap>
                  <Switch
                    checked={parameter.enabled}
                    onChange={(enabled) => updateParameter(parameter.id, { enabled })}
                  />
                  <Select
                    style={{ width: 135 }}
                    value={parameter.scope}
                    options={[
                      { value: "server", label: "Server 参数" },
                      { value: "clientOnly", label: "Client Only" },
                    ]}
                    onChange={(scope) => updateParameter(parameter.id, { scope })}
                  />
                  <Input
                    style={{ flex: "1 1 220px" }}
                    addonBefore="--"
                    value={parameter.key}
                    placeholder="video_codec"
                    onChange={(event) =>
                      updateParameter(parameter.id, { key: event.target.value })
                    }
                  />
                  <Input
                    style={{ flex: "1 1 260px" }}
                    addonBefore="="
                    value={parameter.value}
                    placeholder="h265"
                    onChange={(event) =>
                      updateParameter(parameter.id, { value: event.target.value })
                    }
                  />
                  <Button
                    danger
                    type="text"
                    icon={<DeleteOutlined />}
                    onClick={() => deleteParameter(parameter.id)}
                  />
                </Flex>
              </Card>
            ))}
            <Button block type="dashed" icon={<PlusOutlined />} onClick={addParameter}>
              添加参数
            </Button>
          </Space>

          <Divider orientation="left">命令预览</Divider>
          <Typography.Paragraph copyable={{ text: preview }}>
            <Typography.Text code>{preview}</Typography.Text>
          </Typography.Paragraph>
          <Space wrap>
            <Tag color="blue">Server 参数会覆盖现有视频/音频设置</Tag>
            <Tag color="gold">Client Only 仅用于记录和预览</Tag>
            <Tag color="green">下次连接或重新连接设备时生效</Tag>
          </Space>
        </>
      )}
    </Modal>
  );
}
