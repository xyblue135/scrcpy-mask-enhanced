import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Divider,
  Empty,
  Flex,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  DownOutlined,
  PlusOutlined,
  ThunderboltOutlined,
  UpOutlined,
} from "@ant-design/icons";
import type {
  ButtonBinding,
  MappingConfig,
  MappingType,
  ScriptConfig,
} from "./mapping";
import { newMappingId, newScript } from "./mapping";
import { SettingBind } from "./Common";
import { ItemBox, ItemBoxContainer } from "../common/ItemBox";

export const LOWCAST_MACRO_PREFIX = "__LOWCAST_MACRO_V1__:";

type MacroMappingStep = {
  id: string;
  type: "mapping";
  mappingId: string;
  afterMs: number;
};

type MacroWaitStep = {
  id: string;
  type: "wait";
  waitMs: number;
};

export type MacroStep = MacroMappingStep | MacroWaitStep;

export type MacroMeta = {
  version: 1;
  name: string;
  preventOverlap: boolean;
  steps: MacroStep[];
};

function stepId() {
  return newMappingId();
}

function defaultMacroMeta(name: string): MacroMeta {
  return {
    version: 1,
    name,
    preventOverlap: true,
    steps: [],
  };
}

export function isMacroScript(mapping: MappingType): mapping is ScriptConfig {
  return (
    mapping.type === "Script" &&
    typeof mapping.note === "string" &&
    mapping.note.startsWith(LOWCAST_MACRO_PREFIX)
  );
}

export function readMacroMeta(mapping: ScriptConfig): MacroMeta {
  if (!isMacroScript(mapping)) return defaultMacroMeta("宏");
  try {
    const parsed = JSON.parse(mapping.note.slice(LOWCAST_MACRO_PREFIX.length));
    return {
      version: 1,
      name:
        typeof parsed.name === "string" && parsed.name.trim()
          ? parsed.name.trim()
          : "未命名宏",
      preventOverlap: parsed.preventOverlap !== false,
      steps: Array.isArray(parsed.steps)
        ? parsed.steps.map((step: any) => ({ ...step, id: step.id || stepId() }))
        : [],
    };
  } catch {
    return defaultMacroMeta("损坏的宏配置");
  }
}

function writeMacroMeta(meta: MacroMeta) {
  return LOWCAST_MACRO_PREFIX + JSON.stringify(meta);
}

function getPosition(mapping: MappingType): { x: number; y: number } | null {
  if ("position" in mapping && mapping.position) return mapping.position;
  return null;
}

function displayBind(mapping: MappingType) {
  if (!Array.isArray(mapping.bind)) return mapping.type;
  return mapping.bind.length ? mapping.bind.join("+") : mapping.type;
}

function targetLabel(mapping: MappingType) {
  const note = "note" in mapping && mapping.note && !isMacroScript(mapping)
    ? mapping.note
    : "";
  const binding = displayBind(mapping);
  return note
    ? `${note} · ${binding} · ${mapping.type}`
    : `${binding} · ${mapping.type} · ${mapping.id}`;
}

function macroPointerId(mapping: ScriptConfig) {
  const raw = Number.parseInt(mapping.id.slice(-6), 16);
  return 1000 + (Number.isFinite(raw) ? raw : 0);
}

export function compileMacroScript(
  macro: ScriptConfig,
  meta: MacroMeta,
  config: MappingConfig,
) {
  const pointerId = macroPointerId(macro);
  const lines: string[] = [];
  const indent = meta.preventOverlap ? "    " : "";

  if (meta.preventOverlap) {
    lines.push('if state_get("running", false) == false {');
    lines.push('    state_set("running", true)');
  }

  for (const step of meta.steps) {
    if (step.type === "wait") {
      if (step.waitMs > 0) lines.push(`${indent}wait(${Math.round(step.waitMs)})`);
      continue;
    }

    if (step.type === "mapping") {
      const target = config.mappings.find(
        (item) => item.id === step.mappingId && !isMacroScript(item),
      );
      const pos = target ? getPosition(target) : null;
      if (pos) {
        lines.push(`${indent}tap(${pointerId}, ${Math.round(pos.x)}, ${Math.round(pos.y)})`);
      } else {
        lines.push(`${indent}// Missing mapping target: ${step.mappingId}`);
      }
      if (step.afterMs > 0) lines.push(`${indent}wait(${Math.round(step.afterMs)})`);
      continue;
    }

  }

  if (meta.preventOverlap) {
    lines.push('    state_set("running", false)');
    lines.push("}");
  }

  return lines.join("\n");
}

export function syncMacroScripts(config: MappingConfig): MappingConfig {
  const next: MappingConfig = {
    ...config,
    mappings: config.mappings.map((item) => ({ ...item })) as MappingType[],
  };
  next.mappings = next.mappings.map((item) => {
    if (!isMacroScript(item)) return item;
    const meta = readMacroMeta(item);
    return {
      ...item,
      pressed_script: compileMacroScript(item, meta, next),
      held_script: "",
      released_script: "",
      interval: 300,
    };
  });
  return next;
}

function updateMacroInConfig(
  config: MappingConfig,
  macroId: string,
  updater: (macro: ScriptConfig, meta: MacroMeta) => ScriptConfig,
) {
  const next: MappingConfig = {
    ...config,
    mappings: config.mappings.map((mapping) => {
      if (mapping.id !== macroId || !isMacroScript(mapping)) return mapping;
      return updater(mapping, readMacroMeta(mapping));
    }),
  };
  return syncMacroScripts(next);
}

function MappingStepEditor({
  step,
  targetOptions,
  onChange,
}: {
  step: MacroMappingStep;
  targetOptions: { label: string; value: string }[];
  onChange: (step: MacroMappingStep) => void;
}) {
  return (
    <Space.Compact className="w-full">
      <Select
        className="w-full"
        showSearch
        optionFilterProp="label"
        placeholder="选择已有键位，例如跳跃/技能"
        value={step.mappingId || undefined}
        options={targetOptions}
        onChange={(mappingId) => onChange({ ...step, mappingId })}
      />
      <InputNumber
        addonBefore="后延迟"
        addonAfter="ms"
        min={0}
        value={step.afterMs}
        onChange={(value) => value !== null && onChange({ ...step, afterMs: value })}
      />
    </Space.Compact>
  );
}

export default function MacroPresetModal({
  open,
  config,
  onClose,
  onConfigChange,
}: {
  open: boolean;
  config: MappingConfig | null;
  onClose: () => void;
  onConfigChange: (config: MappingConfig) => void;
}) {
  const macros = useMemo(
    () => (config?.mappings.filter(isMacroScript) ?? []) as ScriptConfig[],
    [config],
  );
  const [selectedId, setSelectedId] = useState("");

  useEffect(() => {
    if (!open) return;
    if (selectedId && macros.some((item) => item.id === selectedId)) return;
    setSelectedId(macros[0]?.id ?? "");
  }, [open, macros, selectedId]);

  const selected = macros.find((item) => item.id === selectedId) ?? null;
  const meta = selected ? readMacroMeta(selected) : null;
  const targetOptions = useMemo(() => {
    if (!config) return [];
    return config.mappings
      .filter((item) => !isMacroScript(item) && getPosition(item) !== null)
      .map((item) => ({ label: targetLabel(item), value: item.id }));
  }, [config]);

  function commitMacro(
    updater: (macro: ScriptConfig, meta: MacroMeta) => ScriptConfig,
  ) {
    if (!config || !selected) return;
    onConfigChange(updateMacroInConfig(config, selected.id, updater));
  }

  function updateMeta(nextMeta: MacroMeta) {
    commitMacro((macro) => ({ ...macro, note: writeMacroMeta(nextMeta) }));
  }

  function updateBind(bind: ButtonBinding) {
    commitMacro((macro) => ({ ...macro, bind }));
  }

  function addMacro() {
    if (!config) return;
    const number = macros.length + 1;
    const macro = newScript({ x: 0, y: 0 });
    const meta = defaultMacroMeta(`宏 ${number}`);
    macro.note = writeMacroMeta(meta);
    macro.bind = [];
    macro.pressed_script = compileMacroScript(macro, meta, config);
    const next = syncMacroScripts({
      ...config,
      mappings: [...config.mappings, macro],
    });
    onConfigChange(next);
    setSelectedId(macro.id);
  }

  function deleteMacro() {
    if (!config || !selected) return;
    onConfigChange({
      ...config,
      mappings: config.mappings.filter((item) => item.id !== selected.id),
    });
    setSelectedId("");
  }

  function addStep(type: MacroStep["type"]) {
    if (!meta) return;
    let step: MacroStep;
    if (type === "mapping") {
      step = {
        id: stepId(),
        type,
        mappingId: targetOptions[0]?.value ?? "",
        afterMs: 50,
      };
    } else {
      step = { id: stepId(), type, waitMs: 100 };
    }
    updateMeta({ ...meta, steps: [...meta.steps, step] });
  }

  function updateStep(index: number, nextStep: MacroStep) {
    if (!meta) return;
    const steps = [...meta.steps];
    steps[index] = nextStep;
    updateMeta({ ...meta, steps });
  }

  function deleteStep(index: number) {
    if (!meta) return;
    updateMeta({ ...meta, steps: meta.steps.filter((_, i) => i !== index) });
  }

  function moveStep(index: number, direction: -1 | 1) {
    if (!meta) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= meta.steps.length) return;
    const steps = [...meta.steps];
    [steps[index], steps[nextIndex]] = [steps[nextIndex], steps[index]];
    updateMeta({ ...meta, steps });
  }

  return (
    <Modal
      title={<Space><ThunderboltOutlined />宏预设</Space>}
      open={open}
      width={980}
      footer={null}
      destroyOnHidden
      onCancel={onClose}
    >
      {!config ? (
        <Empty description="请先打开一个键位配置" />
      ) : (
        <Flex gap={20} align="stretch" className="min-h-520px">
          <Flex vertical gap={8} className="w-60 shrink-0 border-r border-solid border-border-secondary pr-4">
            <Button type="primary" icon={<PlusOutlined />} onClick={addMacro}>新建宏</Button>
            {macros.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无宏" />}
            {macros.map((macro) => {
              const itemMeta = readMacroMeta(macro);
              return (
                <Button
                  key={macro.id}
                  type={macro.id === selectedId ? "primary" : "default"}
                  onClick={() => setSelectedId(macro.id)}
                  className="text-left"
                >
                  {itemMeta.name} {macro.bind.length ? `(${macro.bind.join("+")})` : "(未绑定)"}
                </Button>
              );
            })}
          </Flex>

          <div className="flex-1 min-w-0">
            {!selected || !meta ? (
              <Empty description="选择或新建一个宏" />
            ) : (
              <Flex vertical gap={14}>
                <Flex justify="space-between" align="center">
                  <Typography.Title level={4} className="m-0">{meta.name}</Typography.Title>
                  <Popconfirm title="删除这个宏？" onConfirm={deleteMacro} okText="删除" cancelText="取消">
                    <Button danger icon={<DeleteOutlined />}>删除宏</Button>
                  </Popconfirm>
                </Flex>

                <ItemBoxContainer gap={12}>
                  <ItemBox label="宏名称">
                    <Input
                      value={meta.name}
                      onChange={(event) => updateMeta({ ...meta, name: event.target.value })}
                    />
                  </ItemBox>
                  <SettingBind
                    label="触发按键"
                    tooltip="例如绑定 Numpad4。按下一次只执行一轮宏，不需要一直按住。"
                    bind={selected.bind}
                    onBindChange={updateBind}
                  />
                  <ItemBox
                    label="执行中禁止重复触发"
                    tooltip="默认开启。宏尚未执行完时再次按触发键不会叠加第二套动作，避免连续按键造成多个宏并发触摸。"
                  >
                    <Switch
                      checked={meta.preventOverlap}
                      onChange={(preventOverlap) => updateMeta({ ...meta, preventOverlap })}
                    />
                  </ItemBox>
                </ItemBoxContainer>

                <Divider className="my-1" />
                <Flex justify="space-between" align="center" wrap="wrap">
                  <Typography.Text strong>动作步骤（按顺序执行）</Typography.Text>
                  <Space wrap>
                    <Button size="small" onClick={() => addStep("mapping")}>+ 已有键位</Button>
                    <Button size="small" onClick={() => addStep("wait")}>+ 等待</Button>
                  </Space>
                </Flex>

                <Flex vertical gap={10} className="max-h-52vh overflow-y-auto pr-2 scrollbar">
                  {meta.steps.length === 0 && (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有动作。例如：已有键位“跳跃” → 等待 60ms → 已有键位“技能”" />
                  )}
                  {meta.steps.map((step, index) => (
                    <Flex
                      key={step.id}
                      gap={10}
                      align="center"
                      className="rounded border border-solid border-border-secondary p-3"
                    >
                      <Typography.Text className="w-8 shrink-0" strong>#{index + 1}</Typography.Text>
                      <div className="flex-1 min-w-0">
                        {step.type === "mapping" && (
                          <MappingStepEditor step={step} targetOptions={targetOptions} onChange={(next) => updateStep(index, next)} />
                        )}
                        {step.type === "wait" && (
                          <InputNumber
                            className="w-full"
                            addonBefore="等待"
                            addonAfter="ms"
                            min={0}
                            value={step.waitMs}
                            onChange={(waitMs) => waitMs !== null && updateStep(index, { ...step, waitMs })}
                          />
                        )}
                      </div>
                      <Space.Compact>
                        <Button icon={<UpOutlined />} disabled={index === 0} onClick={() => moveStep(index, -1)} />
                        <Button icon={<DownOutlined />} disabled={index === meta.steps.length - 1} onClick={() => moveStep(index, 1)} />
                        <Button danger icon={<DeleteOutlined />} onClick={() => deleteStep(index)} />
                      </Space.Compact>
                    </Flex>
                  ))}
                </Flex>

                <Typography.Text type="secondary">
                  “已有键位”会引用当前键位 ID；你以后解锁并拖动跳跃/技能的位置，保存配置时宏脚本会自动重新生成到新坐标。
                </Typography.Text>
              </Flex>
            )}
          </div>
        </Flex>
      )}
    </Modal>
  );
}
