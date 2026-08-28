import { Button, Card, Flex, InputNumber, Select } from "antd";
import { useTranslation } from "react-i18next";
import { requestPost } from "../utils";
import { useMessageContext } from "../hooks";
import { useAppSelector } from "../store/store";
import { useState } from "react";
import { ReloadOutlined } from "@ant-design/icons";

export default function AdbResolution() {
  const { t } = useTranslation();
  const messageApi = useMessageContext()!;
  const controlledDevices = useAppSelector(
    (state) => state.other.controlledDevices,
  );

  const [selectedDevice, setSelectedDevice] = useState<string | undefined>();
  const [sizeValue, setSizeValue] = useState<string>("");
  const [sizeLoading, setSizeLoading] = useState(false);
  const [densityValue, setDensityValue] = useState<number | null>(null);
  const [densityLoading, setDensityLoading] = useState(false);

  const deviceOptions = controlledDevices.map((d) => ({
    label: `${d.name} (${d.device_id})`,
    value: d.device_id,
  }));

  const selectedDeviceInfo = controlledDevices.find(
    (d) => d.device_id === selectedDevice,
  );

  async function handleSetSize() {
    if (!selectedDevice) return;
    setSizeLoading(true);
    try {
      await requestPost("/api/device/adb_wm_size", {
        device_id: selectedDevice,
        value: sizeValue || null,
      });
      messageApi.success(t("adbResolution.setSizeSuccess"));
    } catch (err: any) {
      messageApi.error(typeof err === "string" ? err : `${err}`);
    } finally {
      setSizeLoading(false);
    }
  }

  async function handleResetSize() {
    if (!selectedDevice) return;
    setSizeLoading(true);
    try {
      await requestPost("/api/device/adb_wm_size", {
        device_id: selectedDevice,
        value: null,
      });
      messageApi.success(t("adbResolution.resetSizeSuccess"));
      setSizeValue("");
    } catch (err: any) {
      messageApi.error(typeof err === "string" ? err : `${err}`);
    } finally {
      setSizeLoading(false);
    }
  }

  async function handleSetDensity() {
    if (!selectedDevice) return;
    setDensityLoading(true);
    try {
      await requestPost("/api/device/adb_wm_density", {
        device_id: selectedDevice,
        value: densityValue ? String(densityValue) : null,
      });
      messageApi.success(t("adbResolution.setDensitySuccess"));
    } catch (err: any) {
      messageApi.error(typeof err === "string" ? err : `${err}`);
    } finally {
      setDensityLoading(false);
    }
  }

  async function handleResetDensity() {
    if (!selectedDevice) return;
    setDensityLoading(true);
    try {
      await requestPost("/api/device/adb_wm_density", {
        device_id: selectedDevice,
        value: null,
      });
      messageApi.success(t("adbResolution.resetDensitySuccess"));
      setDensityValue(null);
    } catch (err: any) {
      messageApi.error(typeof err === "string" ? err : `${err}`);
    } finally {
      setDensityLoading(false);
    }
  }

  return (
    <Flex vertical gap={16} className="p-4">
      <Card title={t("adbResolution.title")}>
        <Flex vertical gap={16}>
          {deviceOptions.length === 0 ? (
            <div className="text-color-secondary">
              {t("adbResolution.noDevice")}
            </div>
          ) : (
            <>
              <Flex align="center" gap={8}>
                <span className="font-bold whitespace-nowrap">
                  {t("adbResolution.selectDevice")}:
                </span>
                <Select
                  className="min-w-48"
                  placeholder={t("adbResolution.devicePlaceholder")}
                  options={deviceOptions}
                  value={selectedDevice}
                  onChange={setSelectedDevice}
                  allowClear
                />
              </Flex>

              {selectedDeviceInfo && (
                <Flex gap={8} className="text-xs text-color-secondary mb-2">
                  <span>
                    {t("adbResolution.currentSize")}:{" "}
                    {selectedDeviceInfo.device_size[0]} x{" "}
                    {selectedDeviceInfo.device_size[1]}
                  </span>
                  {selectedDeviceInfo.device_dpi > 0 && (
                    <>
                      <span>|</span>
                      <span>
                        {t("adbResolution.currentDensity")}:{" "}
                        {selectedDeviceInfo.device_dpi}dpi
                      </span>
                    </>
                  )}
                </Flex>
              )}

              <Card
                size="small"
                title={t("adbResolution.screenSize")}
                className="w-full"
              >
                <Flex vertical gap={12}>
                  <Flex align="center" gap={8}>
                    <InputNumber
                      className="flex-1"
                      placeholder={t("adbResolution.sizePlaceholder")}
                      value={sizeValue}
                      onChange={(v) => setSizeValue(v ?? "")}
                      stringMode
                      style={{ width: 200 }}
                    />
                    <Button
                      type="primary"
                      onClick={handleSetSize}
                      loading={sizeLoading}
                      disabled={!selectedDevice}
                    >
                      {t("adbResolution.setSize")}
                    </Button>
                    <Button
                      icon={<ReloadOutlined />}
                      onClick={handleResetSize}
                      loading={sizeLoading}
                      disabled={!selectedDevice}
                    >
                      {t("adbResolution.resetSize")}
                    </Button>
                  </Flex>
                  <div className="text-xs text-color-secondary">
                    {t("adbResolution.sizeHint")}
                  </div>
                </Flex>
              </Card>

              <Card
                size="small"
                title={t("adbResolution.screenDensity")}
                className="w-full"
              >
                <Flex vertical gap={12}>
                  <Flex align="center" gap={8}>
                    <InputNumber
                      className="flex-1"
                      placeholder={t("adbResolution.densityPlaceholder")}
                      value={densityValue}
                      onChange={(v) => setDensityValue(v)}
                      min={120}
                      max={640}
                      style={{ width: 200 }}
                    />
                    <Button
                      type="primary"
                      onClick={handleSetDensity}
                      loading={densityLoading}
                      disabled={!selectedDevice}
                    >
                      {t("adbResolution.setDensity")}
                    </Button>
                    <Button
                      icon={<ReloadOutlined />}
                      onClick={handleResetDensity}
                      loading={densityLoading}
                      disabled={!selectedDevice}
                    >
                      {t("adbResolution.resetDensity")}
                    </Button>
                  </Flex>
                  <div className="text-xs text-color-secondary">
                    {t("adbResolution.densityHint")}
                  </div>
                </Flex>
              </Card>
            </>
          )}
        </Flex>
      </Card>
    </Flex>
  );
}