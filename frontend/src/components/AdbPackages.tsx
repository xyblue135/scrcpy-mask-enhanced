import { Button, Card, Flex, Input, Select, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { requestPost } from "../utils";
import { useMessageContext } from "../hooks";
import { useAppSelector } from "../store/store";
import { useMemo, useState } from "react";

export default function AdbPackages() {
  const { t } = useTranslation();
  const messageApi = useMessageContext()!;
  const controlledDevices = useAppSelector(
    (state) => state.other.controlledDevices,
  );

  const [selectedDevice, setSelectedDevice] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [packages, setPackages] = useState<string[]>([]);
  const [searchText, setSearchText] = useState("");

  const deviceOptions = controlledDevices.map((d) => ({
    label: `${d.name} (${d.device_id})`,
    value: d.device_id,
  }));

  const filteredPackages = useMemo(() => {
    if (!searchText.trim()) return packages;
    const kw = searchText.trim().toLowerCase();
    return packages.filter((pkg) => pkg.toLowerCase().includes(kw));
  }, [packages, searchText]);

  async function fetchPackages() {
    if (!selectedDevice) return;
    setLoading(true);
    setSearchText("");
    try {
      const res = await requestPost<{ packages: string[]; raw_cmd: string }>(
        "/api/device/adb_pm_list_packages",
        { device_id: selectedDevice },
      );
      setPackages(res.data.packages);
    } catch (err: any) {
      messageApi.error(typeof err === "string" ? err : `${err}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Flex vertical gap={16} className="p-4 max-w-2xl">
      <Card title={t("adbPackages.title")}>
        {deviceOptions.length === 0 ? (
          <div className="text-color-secondary">
            {t("adbPackages.noDevice")}
          </div>
        ) : (
          <Flex vertical gap={16}>
            {/* Device selection */}
            <Flex vertical gap={6}>
              <Typography.Text strong>
                {t("adbPackages.selectDevice")}
              </Typography.Text>
              <Flex gap={8}>
                <Select
                  placeholder={t("adbPackages.devicePlaceholder")}
                  options={deviceOptions}
                  value={selectedDevice}
                  onChange={(v) => {
                    setSelectedDevice(v);
                    setPackages([]);
                    setSearchText("");
                  }}
                  allowClear
                  className="flex-1"
                />
                <Button
                  type="primary"
                  onClick={fetchPackages}
                  loading={loading}
                  disabled={!selectedDevice}
                >
                  {t("adbPackages.listPackages")}
                </Button>
              </Flex>
            </Flex>

            {/* Command preview (gray, read-only) */}
            <Flex vertical gap={6}>
              <Typography.Text strong>
                {t("adbPackages.commandPreview")}
              </Typography.Text>
              <div className="bg-[var(--ant-color-bg-layout)] rounded px-3 py-2 font-mono text-sm leading-relaxed text-color-secondary cursor-default select-none">
                adb shell pm list packages
              </div>
            </Flex>

            {/* Search filter */}
            {packages.length > 0 && (
              <Flex vertical gap={6}>
                <Typography.Text strong>
                  {t("adbPackages.search")}
                </Typography.Text>
                <Input.Search
                  placeholder={t("adbPackages.searchPlaceholder")}
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  allowClear
                />
              </Flex>
            )}

            {/* Package count */}
            {packages.length > 0 && (
              <Typography.Text type="secondary">
                {t("adbPackages.packageCount", {
                  total: packages.length,
                  filtered: filteredPackages.length,
                })}
              </Typography.Text>
            )}

            {/* Package list */}
            {filteredPackages.length > 0 && (
              <div className="bg-[var(--ant-color-bg-layout)] rounded px-3 py-2 font-mono text-sm leading-relaxed max-h-80 overflow-y-auto select-text">
                {filteredPackages.map((pkg) => (
                  <div key={pkg} className="py-0.5 border-b border-[var(--ant-color-border-secondary)] last:border-none">
                    {pkg}
                  </div>
                ))}
              </div>
            )}

            {/* Empty state */}
            {packages.length > 0 && filteredPackages.length === 0 && (
              <div className="text-color-secondary text-center py-8">
                {t("adbPackages.noMatch")}
              </div>
            )}
          </Flex>
        )}
      </Card>
    </Flex>
  );
}