import { useTranslation } from "react-i18next";
import { Card, Flex, InputNumber, Slider, Switch, Typography } from "antd";
import { useAppDispatch, useAppSelector } from "../store/store";
import { setMoveDistanceThreshold, setMoveAdaptiveEnabled, setMoveAdaptiveWindow, setTouchProbeEnabled } from "../store/localConfig";

export default function LatencyCompare() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const touchProbeEnabled = useAppSelector(
    (state) => state.localConfig.touchProbeEnabled,
  );
  const moveThreshold = useAppSelector(
    (state) => state.localConfig.moveDistanceThreshold,
  );
  const moveAdaptiveEnabled = useAppSelector(
    (state) => state.localConfig.moveAdaptiveEnabled,
  );
  const moveAdaptiveWindow = useAppSelector(
    (state) => state.localConfig.moveAdaptiveWindow,
  );

  return (
    <div className="page-container hide-scrollbar">
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {t("latencyCompare.title")}
      </Typography.Title>

      <Flex vertical gap={16}>
        {/* 屏幕性能监控：perf.jsonl */}
        <Card
          size="small"
          title={
            <Flex align="center" gap={8}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "var(--primary-color, #7c3aed)",
                  flexShrink: 0,
                }}
              />
              <Typography.Text strong>
                {t("latencyCompare.screenPerfTitle")}
              </Typography.Text>
            </Flex>
          }
        >
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {t("latencyCompare.screenPerfDesc")}
          </Typography.Text>
        </Card>

        {/* 映射性能监控：touch_probe.jsonl */}
        <Card
          size="small"
          title={
            <Flex align="center" gap={8}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#f59e0b",
                  flexShrink: 0,
                }}
              />
              <Typography.Text strong>
                {t("latencyCompare.touchProbeEnabled")}
              </Typography.Text>
            </Flex>
          }
          extra={
            <Switch
              checked={touchProbeEnabled}
              onChange={(v) => dispatch(setTouchProbeEnabled(v))}
              checkedChildren={t("latencyCompare.touchProbeOn")}
              unCheckedChildren={t("latencyCompare.touchProbeOff")}
            />
          }
        >
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {t("latencyCompare.touchProbeDesc")}
          </Typography.Text>
        </Card>

        {/* Move 事件距离阈值降噪 */}
        <Card
          size="small"
          title={
            <Flex align="center" gap={8}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "#10b981",
                  flexShrink: 0,
                }}
              />
              <Typography.Text strong>
                {t("latencyCompare.moveThresholdTitle")}
              </Typography.Text>
            </Flex>
          }
        >
          <Flex vertical gap={12}>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              {t("latencyCompare.moveThresholdDesc")}
            </Typography.Text>

            <Flex align="center" gap={12}>
              <Slider
                min={0}
                max={64}
                step={1}
                value={moveThreshold}
                onChange={(v) => dispatch(setMoveDistanceThreshold(v as number))}
                style={{ flex: 1, minWidth: 160 }}
                tooltip={{ formatter: (v) => `${v} px` }}
              />
              <InputNumber
                min={0}
                max={64}
                step={1}
                value={moveThreshold}
                onChange={(v) =>
                  v !== null && dispatch(setMoveDistanceThreshold(v))
                }
                style={{ width: 90 }}
                addonAfter="px"
              />
            </Flex>

            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("latencyCompare.moveThresholdUnit", {
                value: moveThreshold,
              })}
            </Typography.Text>

            <Flex
              align="center"
              justify="space-between"
              wrap
              gap={12}
              style={{ marginTop: 4 }}
            >
              <Flex align="center" gap={8} wrap>
                <Typography.Text style={{ fontSize: 13 }}>
                  {t("latencyCompare.moveAdaptiveTitle")}
                </Typography.Text>
                <Switch
                  size="small"
                  checked={moveAdaptiveEnabled}
                  onChange={(v) => dispatch(setMoveAdaptiveEnabled(v))}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t("latencyCompare.moveAdaptiveUnit", {
                    window: moveAdaptiveWindow,
                    max: Math.max(1, moveAdaptiveWindow) * 2,
                  })}
                </Typography.Text>
              </Flex>
              <Flex align="center" gap={6} wrap style={{ minWidth: 200 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t("latencyCompare.moveAdaptiveWindow")}
                </Typography.Text>
                <Slider
                  min={2}
                  max={32}
                  step={1}
                  value={moveAdaptiveWindow}
                  onChange={(v) => dispatch(setMoveAdaptiveWindow(v as number))}
                  style={{ flex: 1, minWidth: 100 }}
                  tooltip={{ formatter: (v) => `${v}` }}
                />
                <InputNumber
                  min={2}
                  max={32}
                  step={1}
                  value={moveAdaptiveWindow}
                  onChange={(v) =>
                    v !== null && dispatch(setMoveAdaptiveWindow(v))
                  }
                  style={{ width: 70 }}
                />
              </Flex>
            </Flex>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("latencyCompare.moveAdaptiveDesc")}
            </Typography.Text>
          </Flex>
        </Card>
      </Flex>
    </div>
  );
}