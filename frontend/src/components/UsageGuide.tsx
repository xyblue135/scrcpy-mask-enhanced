import { Card, Flex, Typography } from "antd";
import { useTranslation } from "react-i18next";

export default function UsageGuide() {
  const { t } = useTranslation();

  return (
    <Flex vertical gap={16} className="p-4 max-w-3xl">
      <Card title={t("usageGuide.title")}>
        <Typography.Paragraph style={{ whiteSpace: "pre-line" }}>
          {t("usageGuide.content")}
        </Typography.Paragraph>
      </Card>

      <Card title={t("usageGuide.perfMonitorTitle")}>
        <Typography.Paragraph style={{ whiteSpace: "pre-line" }}>
          {t("usageGuide.perfMonitorContent")}
        </Typography.Paragraph>
      </Card>
    </Flex>
  );
}