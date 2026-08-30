import { useTranslation } from "react-i18next";
import { Card, Flex, Switch, Typography } from "antd";
import { useAppDispatch, useAppSelector } from "../store/store";
import { setPerfEnabled, setTouchProbeEnabled } from "../store/localConfig";

export default function LatencyCompare() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const perfEnabled = useAppSelector(
    (state) => state.localConfig.perfEnabled,
  );
  const touchProbeEnabled = useAppSelector(
    (state) => state.localConfig.touchProbeEnabled,
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
          extra={
            <Switch
              checked={perfEnabled}
              onChange={(v) => dispatch(setPerfEnabled(v))}
            />
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
            />
          }
        >
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {t("latencyCompare.touchProbeDesc")}
          </Typography.Text>
        </Card>
      </Flex>
    </div>
  );
}