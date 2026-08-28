import { Flex, Menu, Layout } from "antd";
import { useState } from "react";
import logo from "../assets/128x128.png";
import { BookOutlined, CameraOutlined, CodeFilled, SettingFilled } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { IconFont } from "../hooks";

const deviceParamRoutes = [
  "/startup-size",
  "/adb-resolution",
  "/adb-packages",
];

export default function Sider() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const isOnDeviceParam = deviceParamRoutes.includes(location.pathname);
  const [openKeys, setOpenKeys] = useState<string[]>(
    isOnDeviceParam ? ["/device-params"] : [],
  );

  return (
    <Layout.Sider
      width={220}
      theme="light"
    >
      <Flex
        justify="center"
        align="end"
        className="pt-3 pb-3 cursor-pointer"
        onClick={() =>
          window.open("https://github.com/AkiChase/scrcpy-mask", "_blank")
        }
      >
        <i
          className="w-8 h-8 bg-cover flex-shrink-0"
          style={{
            backgroundImage: `url(${logo})`,
          }}
        ></i>
        <div
          className="ml-3"
        >
          <span className="color-text font-bold text-4">Scrcpy Mask</span>
        </div>
      </Flex>
      <Menu
        selectedKeys={[location.pathname]}
        openKeys={openKeys}
        onOpenChange={(keys) => setOpenKeys(keys)}
        onSelect={({ key }) => {
          navigate(key, { replace: true });
        }}
      >
        <Menu.Item key="/usage-guide" icon={<BookOutlined />}>
          {t("sider.usageGuide")}
        </Menu.Item>
        <Menu.Item key="/scrcpy" icon={<CodeFilled />}>
          {t("sider.scrcpyPresets")}
        </Menu.Item>
        <Menu.Item key="/devices" icon={<IconFont type="icon-android" />}>
          {t("sider.devices")}
        </Menu.Item>
        <Menu.Item key="/mappings" icon={<IconFont type="icon-keyboard" />}>
          {t("sider.mappings")}
        </Menu.Item>
        <Menu.SubMenu
          key="/device-params"
          icon={<IconFont type="icon-android" />}
          title={t("sider.deviceParams")}
        >
          <Menu.Item key="/startup-size" icon={<IconFont type="icon-android" />}>
            {t("sider.startupSize")}
          </Menu.Item>
          <Menu.Item key="/adb-resolution" icon={<IconFont type="icon-android" />}>
            {t("sider.adbResolution")}
          </Menu.Item>
          <Menu.Item key="/adb-packages" icon={<IconFont type="icon-android" />}>
            {t("sider.adbPackages")}
          </Menu.Item>
        </Menu.SubMenu>
        <Menu.Item key="/latency-compare" icon={<CameraOutlined />}>
          {t("sider.latencyCompare")}
        </Menu.Item>
        <Menu.Item key="/settings" icon={<SettingFilled />}>
          {t("sider.settings")}
        </Menu.Item>
      </Menu>
    </Layout.Sider>
  );
}