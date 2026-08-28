import { Card, Flex, InputNumber, Typography } from "antd";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "../store/store";
import {
  sethorizontalMaskWidth,
  setverticalMaskHeight,
  setVerticalPosition,
  setHorizontalPosition,
} from "../store/localConfig";

export default function StartupSize() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const localConfig = useAppSelector((state) => state.localConfig);

  return (
    <Flex vertical gap={16} className="p-4 max-w-2xl">
      <Card title={t("startupSize.title")}>
        <Flex vertical gap={16}>
          <Typography.Text type="secondary">
            {t("startupSize.desc")}
          </Typography.Text>

          <Flex vertical gap={12}>
            <Flex align="center" gap={12}>
              <Typography.Text className="w-32 shrink-0">
                {t("startupSize.verticalMaskHeight")}:
              </Typography.Text>
              <InputNumber
                className="w-48"
                min={1}
                value={localConfig.verticalMaskHeight}
                onChange={(value) =>
                  value !== null && dispatch(setverticalMaskHeight(value))
                }
              />
            </Flex>

            <Flex align="center" gap={12}>
              <Typography.Text className="w-32 shrink-0">
                {t("startupSize.horizontalMaskWidth")}:
              </Typography.Text>
              <InputNumber
                className="w-48"
                min={1}
                value={localConfig.horizontalMaskWidth}
                onChange={(value) =>
                  value !== null && dispatch(sethorizontalMaskWidth(value))
                }
              />
            </Flex>

            <Flex align="center" gap={12}>
              <Typography.Text className="w-32 shrink-0">
                {t("startupSize.verticalMaskPosition")}:
              </Typography.Text>
              <InputNumber
                className="w-28"
                value={localConfig.verticalPosition[0]}
                onChange={(value) =>
                  value !== null &&
                  dispatch(
                    setVerticalPosition([
                      value,
                      localConfig.verticalPosition[1],
                    ]),
                  )
                }
              />
              <Typography.Text className="text-color-secondary">×</Typography.Text>
              <InputNumber
                className="w-28"
                value={localConfig.verticalPosition[1]}
                onChange={(value) =>
                  value !== null &&
                  dispatch(
                    setVerticalPosition([
                      localConfig.verticalPosition[0],
                      value,
                    ]),
                  )
                }
              />
            </Flex>

            <Flex align="center" gap={12}>
              <Typography.Text className="w-32 shrink-0">
                {t("startupSize.horizontalMaskPosition")}:
              </Typography.Text>
              <InputNumber
                className="w-28"
                value={localConfig.horizontalPosition[0]}
                onChange={(value) =>
                  value !== null &&
                  dispatch(
                    setHorizontalPosition([
                      value,
                      localConfig.horizontalPosition[1],
                    ]),
                  )
                }
              />
              <Typography.Text className="text-color-secondary">×</Typography.Text>
              <InputNumber
                className="w-28"
                value={localConfig.horizontalPosition[1]}
                onChange={(value) =>
                  value !== null &&
                  dispatch(
                    setHorizontalPosition([
                      localConfig.horizontalPosition[0],
                      value,
                    ]),
                  )
                }
              />
            </Flex>
          </Flex>
        </Flex>
      </Card>
    </Flex>
  );
}