import {
  Button,
  Card,
  Flex,
  InputNumber,
  Input,
  Modal,
  Popconfirm,
  Select,
  Table,
  Typography,
} from "antd";
import { useTranslation } from "react-i18next";
import { requestGet, requestPost } from "../utils";
import { useMessageContext } from "../hooks";
import { useAppSelector } from "../store/store";
import { useMemo, useState } from "react";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";

interface UserPreset {
  key: string;
  name: string;
  width: number;
  height: number;
  density: number;
}

const STORAGE_KEY = "custom_adb_presets";

const builtInPresets: UserPreset[] = [
  { key: "reset", name: "adbResolution.presetReset", width: 0, height: 0, density: 0 },
  { key: "720p",  name: "adbResolution.preset720p",  width: 1280, height: 720,  density: 240 },
  { key: "1080p", name: "adbResolution.preset1080p", width: 1920, height: 1080, density: 320 },
  { key: "1440p", name: "adbResolution.preset1440p", width: 2560, height: 1440, density: 440 },
  { key: "custom", name: "adbResolution.presetCustom", width: 0, height: 0, density: 0 },
];

function loadUserPresets(): UserPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveUserPresets(presets: UserPreset[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export default function AdbResolution() {
  const { t } = useTranslation();
  const messageApi = useMessageContext()!;
  const controlledDevices = useAppSelector(
    (state) => state.other.controlledDevices,
  );

  const [selectedDevice, setSelectedDevice] = useState<string | undefined>();
  const [selectedPreset, setSelectedPreset] = useState<string>("reset");
  const [customW, setCustomW] = useState<number | null>(null);
  const [customH, setCustomH] = useState<number | null>(null);
  const [customDpi, setCustomDpi] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [userPresets, setUserPresets] = useState<UserPreset[]>(loadUserPresets);
  const [output, setOutput] = useState<string>("");
  const [presetModalOpen, setPresetModalOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [newPresetW, setNewPresetW] = useState<number | null>(null);
  const [newPresetH, setNewPresetH] = useState<number | null>(null);
  const [newPresetDpi, setNewPresetDpi] = useState<number | null>(null);

  const deviceOptions = controlledDevices.map((d) => ({
    label: `${d.name} (${d.device_id})`,
    value: d.device_id,
  }));

  const isCustom = selectedPreset === "custom";
  const isReset = selectedPreset === "reset";
  const isViewCurrent = selectedPreset === "view_current";

  // Find the current preset (built-in or user)
  const currentPreset = useMemo(() => {
    if (isViewCurrent) return null;
    const builtIn = builtInPresets.find((p) => p.key === selectedPreset);
    if (builtIn) return builtIn;
    return userPresets.find((p) => p.key === selectedPreset) ?? null;
  }, [selectedPreset, userPresets, isViewCurrent]);

  const effectiveWidth = isCustom ? customW : (currentPreset?.width ?? 0);
  const effectiveHeight = isCustom ? customH : (currentPreset?.height ?? 0);
  const effectiveDensity = isCustom ? customDpi : (currentPreset?.density ?? 0);

  // Build command lines
  const commandLines = useMemo<string[]>(() => {
    if (isViewCurrent) {
      return [
        "adb shell wm size",
        "adb shell wm density",
      ];
    }
    if (isReset) {
      return [
        "adb shell wm size reset",
        "adb shell wm density reset",
      ];
    }
    const lines: string[] = [];
    if (effectiveWidth && effectiveHeight) {
      lines.push(`adb shell wm size ${effectiveWidth}x${effectiveHeight}`);
    }
    if (effectiveDensity) {
      lines.push(`adb shell wm density ${effectiveDensity}`);
    }
    return lines;
  }, [isViewCurrent, isReset, isCustom, effectiveWidth, effectiveHeight, effectiveDensity]);

  // Build preset dropdown options
  const presetOptions = useMemo(() => {
    const items: { label: string; value: string; group: string }[] = [];

    // Special options
    items.push({ label: t("adbResolution.viewCurrent"), value: "view_current", group: "system" });

    // Built-in presets
    for (const p of builtInPresets) {
      const label = p.key === "reset"
        ? t(p.name)
        : p.key === "custom"
          ? t(p.name)
          : `${t(p.name)} (${p.width}×${p.height} / ${p.density}dpi)`;
      items.push({ label, value: p.key, group: "builtin" });
    }

    // User presets
    for (const p of userPresets) {
      items.push({
        label: `${p.name} (${p.width}×${p.height} / ${p.density}dpi)`,
        value: p.key,
        group: "user",
      });
    }

    return items;
  }, [t, userPresets]);

  // Fetch current device state
  async function queryCurrent() {
    if (!selectedDevice) return;
    setLoading(true);
    setOutput("");
    try {
      const res = await requestGet<{ size_raw: string; density_raw: string }>(
        "/api/device/adb_wm_current",
        { device_id: selectedDevice },
      );
      setOutput(`${res.data.size_raw}\n${res.data.density_raw}`);
    } catch (err: any) {
      setOutput(`Error: ${typeof err === "string" ? err : `${err}`}`);
    } finally {
      setLoading(false);
    }
  }

  // Apply the preset
  async function handleApply() {
    if (!selectedDevice) return;
    if (isViewCurrent) {
      await queryCurrent();
      return;
    }
    if (commandLines.length === 0) {
      messageApi.warning(t("adbResolution.noCommand"));
      return;
    }

    setLoading(true);
    setOutput("");
    try {
      const results: string[] = [];

      if (isReset) {
        await requestPost("/api/device/adb_wm_size", {
          device_id: selectedDevice, value: null,
        });
        await requestPost("/api/device/adb_wm_density", {
          device_id: selectedDevice, value: null,
        });
        results.push("adb shell wm size reset", "adb shell wm density reset");
      } else {
        if (effectiveWidth && effectiveHeight) {
          await requestPost("/api/device/adb_wm_size", {
            device_id: selectedDevice,
            value: `${effectiveWidth}x${effectiveHeight}`,
          });
          results.push(`adb shell wm size ${effectiveWidth}x${effectiveHeight}`);
        }
        if (effectiveDensity) {
          await requestPost("/api/device/adb_wm_density", {
            device_id: selectedDevice,
            value: String(effectiveDensity),
          });
          results.push(`adb shell wm density ${effectiveDensity}`);
        }
      }

      // Query current state after apply
      try {
        const cur = await requestGet<{ size_raw: string; density_raw: string }>(
          "/api/device/adb_wm_current",
          { device_id: selectedDevice },
        );
        setOutput(`${results.join("\n")}\n\n${cur.data.size_raw}\n${cur.data.density_raw}`);
      } catch {
        setOutput(results.join("\n"));
      }

      messageApi.success(t("adbResolution.applySuccess"));
    } catch (err: any) {
      setOutput(`Error: ${typeof err === "string" ? err : `${err}`}`);
      messageApi.error(typeof err === "string" ? err : `${err}`);
    } finally {
      setLoading(false);
    }
  }

  // Preset management
  function addUserPreset() {
    if (!newPresetName.trim() || !newPresetW || !newPresetH || !newPresetDpi) {
      messageApi.warning(t("adbResolution.presetFormIncomplete"));
      return;
    }
    const key = `user_${Date.now()}`;
    const updated = [...userPresets, { key, name: newPresetName.trim(), width: newPresetW, height: newPresetH, density: newPresetDpi }];
    setUserPresets(updated);
    saveUserPresets(updated);
    setNewPresetName("");
    setNewPresetW(null);
    setNewPresetH(null);
    setNewPresetDpi(null);
    messageApi.success(t("adbResolution.presetAdded"));
  }

  function deleteUserPreset(key: string) {
    const updated = userPresets.filter((p) => p.key !== key);
    setUserPresets(updated);
    saveUserPresets(updated);
    if (selectedPreset === key) setSelectedPreset("reset");
  }

  return (
    <Flex vertical gap={16} className="p-4 max-w-2xl">
      <Card title={t("adbResolution.title")}>
        {deviceOptions.length === 0 ? (
          <div className="text-color-secondary">{t("adbResolution.noDevice")}</div>
        ) : (
          <Flex vertical gap={16}>
            {/* Device selection */}
            <Flex vertical gap={6}>
              <Typography.Text strong>{t("adbResolution.selectDevice")}</Typography.Text>
              <Select
                placeholder={t("adbResolution.devicePlaceholder")}
                options={deviceOptions}
                value={selectedDevice}
                onChange={(v) => {
                  setSelectedDevice(v);
                  setSelectedPreset("reset");
                  setCustomW(null);
                  setCustomH(null);
                  setCustomDpi(null);
                  setOutput("");
                }}
                allowClear
                className="w-full"
              />
            </Flex>

            {/* Preset selection */}
            <Flex vertical gap={6}>
              <Flex align="center" gap={8}>
                <Typography.Text strong>{t("adbResolution.selectPreset")}</Typography.Text>
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => setPresetModalOpen(true)}
                >
                  {t("adbResolution.managePresets")}
                </Button>
              </Flex>
              <Select
                placeholder={t("adbResolution.presetPlaceholder")}
                value={selectedPreset}
                onChange={(v) => {
                  setSelectedPreset(v);
                  if (v !== "custom") {
                    setCustomW(null);
                    setCustomH(null);
                    setCustomDpi(null);
                  }
                  setOutput("");
                }}
                className="w-full"
                options={[
                  {
                    label: t("adbResolution.groupSystem"),
                    options: presetOptions.filter((o) => o.group === "system"),
                  },
                  {
                    label: t("adbResolution.groupBuiltin"),
                    options: presetOptions.filter((o) => o.group === "builtin"),
                  },
                  ...(presetOptions.some((o) => o.group === "user")
                    ? [{
                        label: t("adbResolution.groupUser"),
                        options: presetOptions.filter((o) => o.group === "user"),
                      }]
                    : []),
                ]}
              />
            </Flex>

            {/* Custom inputs */}
            {isCustom && (
              <Flex vertical gap={8} className="pl-2">
                <Flex align="center" gap={8}>
                  <Typography.Text className="w-16 text-right shrink-0">
                    {t("adbResolution.width")}:
                  </Typography.Text>
                  <InputNumber
                    className="flex-1"
                    placeholder="1920"
                    value={customW}
                    onChange={(v) => setCustomW(v)}
                    min={1}
                    max={9999}
                  />
                  <Typography.Text className="w-16 text-right shrink-0">
                    {t("adbResolution.height")}:
                  </Typography.Text>
                  <InputNumber
                    className="flex-1"
                    placeholder="1080"
                    value={customH}
                    onChange={(v) => setCustomH(v)}
                    min={1}
                    max={9999}
                  />
                </Flex>
                <Flex align="center" gap={8}>
                  <Typography.Text className="w-16 text-right shrink-0">
                    {t("adbResolution.density")}:
                  </Typography.Text>
                  <InputNumber
                    className="flex-1"
                    placeholder="320"
                    value={customDpi}
                    onChange={(v) => setCustomDpi(v)}
                    min={120}
                    max={640}
                    style={{ maxWidth: 200 }}
                  />
                </Flex>
              </Flex>
            )}

            {/* Command preview */}
            <Flex vertical gap={6}>
              <Typography.Text strong>{t("adbResolution.commandPreview")}</Typography.Text>
              <div className="bg-[var(--ant-color-bg-layout)] rounded px-3 py-2 font-mono text-sm leading-relaxed whitespace-pre-wrap">
                {commandLines.length > 0
                  ? commandLines.join("\n")
                  : t("adbResolution.noCommand")}
              </div>
            </Flex>

            {/* Apply button */}
            <Button
              type="primary"
              size="large"
              block
              onClick={handleApply}
              loading={loading}
              disabled={!selectedDevice}
            >
              {isViewCurrent ? t("adbResolution.query") : t("adbResolution.apply")}
            </Button>

            {/* Output area */}
            {output && (
              <Flex vertical gap={6}>
                <Typography.Text strong>{t("adbResolution.output")}</Typography.Text>
                <div className="bg-[var(--ant-color-bg-layout)] rounded px-3 py-2 font-mono text-sm leading-relaxed whitespace-pre-wrap">
                  {output}
                </div>
              </Flex>
            )}
          </Flex>
        )}
      </Card>

      {/* Preset management modal */}
      <Modal
        title={t("adbResolution.managePresets")}
        open={presetModalOpen}
        onCancel={() => setPresetModalOpen(false)}
        footer={null}
        className="min-w-500px"
      >
        <Flex vertical gap={16}>
          {/* Existing presets */}
          {userPresets.length > 0 && (
            <Table
              dataSource={userPresets}
              rowKey="key"
              size="small"
              pagination={false}
              columns={[
                { title: t("adbResolution.presetName"), dataIndex: "name", key: "name" },
                { title: t("adbResolution.width"), dataIndex: "width", key: "width", width: 80 },
                { title: t("adbResolution.height"), dataIndex: "height", key: "height", width: 80 },
                { title: t("adbResolution.density"), dataIndex: "density", key: "density", width: 80 },
                {
                  title: "",
                  key: "action",
                  width: 60,
                  render: (_: any, record: UserPreset) => (
                    <Popconfirm
                      title={t("adbResolution.deleteConfirm")}
                      onConfirm={() => deleteUserPreset(record.key)}
                    >
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                      />
                    </Popconfirm>
                  ),
                },
              ]}
            />
          )}

          {/* Add new preset form */}
          <Flex vertical gap={8} className="border-t pt-4">
            <Typography.Text strong>{t("adbResolution.addPreset")}</Typography.Text>
            <Flex align="center" gap={8}>
              <Typography.Text className="w-12 text-right shrink-0">
                {t("adbResolution.presetName")}:
              </Typography.Text>
              <Input
                className="flex-1"
                placeholder={t("adbResolution.presetNamePlaceholder")}
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
              />
            </Flex>
            <Flex align="center" gap={8}>
              <Typography.Text className="w-12 text-right shrink-0">
                {t("adbResolution.width")}:
              </Typography.Text>
              <InputNumber
                className="flex-1"
                placeholder="1920"
                value={newPresetW}
                onChange={(v) => setNewPresetW(v)}
                min={1}
                max={9999}
              />
              <Typography.Text className="w-12 text-right shrink-0">
                {t("adbResolution.height")}:
              </Typography.Text>
              <InputNumber
                className="flex-1"
                placeholder="1080"
                value={newPresetH}
                onChange={(v) => setNewPresetH(v)}
                min={1}
                max={9999}
              />
              <Typography.Text className="w-12 text-right shrink-0">
                {t("adbResolution.density")}:
              </Typography.Text>
              <InputNumber
                className="flex-1"
                placeholder="320"
                value={newPresetDpi}
                onChange={(v) => setNewPresetDpi(v)}
                min={120}
                max={640}
              />
            </Flex>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={addUserPreset}
              className="self-start"
            >
              {t("adbResolution.presetAdd")}
            </Button>
          </Flex>
        </Flex>
      </Modal>
    </Flex>
  );
}