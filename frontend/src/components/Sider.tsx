import { Flex, Menu, Layout } from "antd";
import { useState } from "react";
import logo from "../assets/128x128.png";
import { CameraOutlined, CodeFilled, SettingFilled } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { IconFont } from "../hooks";

export default function Sider() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [siderCollapsed, setSiderCollapsed] = useState(true);

  const brandClass = siderCollapsed
    ? "opacity-0 max-w-0"
    : "opacity-100 max-w-full ml-3";

  // Devices submenu always expanded, never collapsed
  const openKeys = ["/devices"];

  return (
    <Layout.Sider
      collapsed={siderCollapsed}
      onCollapse={(collapsed) => setSiderCollapsed(collapsed)}
      collapsible
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
          className={brandClass}
          style={{
            transition: "1s ease-in-out",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          <span className="color-text font-bold text-4">Scrcpy Mask</span>
        </div>
      </Flex>
      <Menu
        selectedKeys={[location.pathname]}
        openKeys={siderCollapsed ? [] : openKeys}
        onSelect={({ key }) => {
          navigate(key, { replace: true });
        }}
      >
        <Menu.Item key="/scrcpy" icon={<CodeFilled />}>
          {t("sider.scrcpyPresets")}
        </Menu.Item>
        <Menu.SubMenu
          key="/devices"
          icon={<IconFont type="icon-android" />}
          title={t("sider.devices")}
          onTitleClick={({ key }) => navigate(key, { replace: true })}
        >
          <Menu.Item key="/mappings" icon={<IconFont type="icon-keyboard" />}>
            {t("sider.mappings")}
          </Menu.Item>
          <Menu.Item key="/adb-resolution" icon={<IconFont type="icon-android" />}>
            {t("sider.adbResolution")}
          </Menu.Item>
          <Menu.Item key="/adb-packages" icon={<IconFont type="icon-android" />}>
            {t("sider.adbPackages")}
          </Menu.Item>
          <Menu.Item key="/latency-compare" icon={<CameraOutlined />}>
            {t("sider.latencyCompare")}
          </Menu.Item>
        </Menu.SubMenu>
        <Menu.Item key="/settings" icon={<SettingFilled />}>
          {t("sider.settings")}
        </Menu.Item>
      </Menu>
    </Layout.Sider>
  );
}