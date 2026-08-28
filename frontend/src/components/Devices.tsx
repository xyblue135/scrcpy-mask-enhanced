import {
  Badge,
  Button,
  Flex,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  type TableProps,
} from "antd";
import { useTranslation } from "react-i18next";
import {
  requestGet,
  requestPost,
  type AdbDevice,
  type ControlledDevice,
} from "../utils";
import { ReloadOutlined, SyncOutlined, DisconnectOutlined, PlayCircleOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import { ItemBox, ItemBoxContainer } from "./common/ItemBox";
import { setAdbDevices, setControlledDevices, setIsLoading } from "../store/other";
import { useMessageContext } from "../hooks";
import { useAppDispatch, useAppSelector } from "../store/store";
import { useLocation } from "react-router-dom";
import { setActiveMappingFile } from "../store/localConfig";

function MappingSelectCell({ mappingList: list }: { mappingList: string[] }) {
  const dispatch = useAppDispatch();
  const activeMappingFile = useAppSelector(
    (state) => state.localConfig.activeMappingFile,
  );
  return (
    <Select
      style={{ minWidth: 180 }}
      size="small"
      allowClear
      placeholder="选择映射预设"
      value={activeMappingFile || undefined}
      onChange={(val) => {
        dispatch(setActiveMappingFile(val ?? ""));
      }}
      options={list.map((f) => ({ value: f, label: f }))}
    />
  );
}

function ControlledDevices() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const messageApi = useMessageContext();
  const controlledDevices = useAppSelector(
    (state) => state.other.controlledDevices,
  );
  const deviceRotations = useAppSelector(
    (state) => state.other.deviceRotations,
  );

  const [mappingList, setMappingList] = useState<string[]>([]);
  const [scriptModalDevice, setScriptModalDevice] = useState<ControlledDevice | null>(null);
  const [scriptText, setScriptText] = useState("");
  const [scriptOutput, setScriptOutput] = useState("");
  const [scriptRunning, setScriptRunning] = useState(false);

  // 加载映射列表
  useEffect(() => {
    requestGet<{ mapping_list: string[] }>("/api/mapping/get_mapping_list")
      .then((res) => setMappingList(res.data.mapping_list))
      .catch(() => {});
  }, []);

  async function decontrolDevice(device_id: string) {
    dispatch(setIsLoading(true));
    try {
      const res = await requestPost("/api/device/decontrol_device", {
        device_id,
      });
      messageApi?.success(res.message);
    } catch (error) {
      messageApi?.error(error as string);
    }
    dispatch(setIsLoading(false));
  }

  async function executeScript() {
    if (!scriptModalDevice) return;
    setScriptRunning(true);
    setScriptOutput("");

    const lines = scriptText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    let output = "";
    for (const line of lines) {
      try {
        const res = await requestPost<{ output: string }>("/api/device/adb_exec", {
          device_id: scriptModalDevice.device_id,
          command: line,
        });
        output += `$ ${line}\n${res.data.output || ""}\n\n`;
      } catch (error) {
        output += `$ ${line}\nError: ${error}\n\n`;
      }
    }

    setScriptOutput(output);
    setScriptRunning(false);
  }

  const columns: TableProps<ControlledDevice>["columns"] = [
    {
      title: "ID",
      dataIndex: "device_id",
      key: "device_id",
      render: (_, record) => (
        <Space size="large">
          {record.device_id}
          {record.main && (
            <Badge
              color="green"
              text={t("devices.controlledDevices.mainDevice")}
            />
          )}
        </Space>
      ),
    },
    {
      title: t("devices.controlledDevices.name"),
      dataIndex: "name",
      key: "name",
    },
    {
      title: t("devices.controlledDevices.size"),
      dataIndex: "device_size",
      key: "device_size",
      render: (device_size) => {
        return `${device_size[0]}x${device_size[1]}`;
      },
    },
    {
      title: t("devices.controlledDevices.rotation"),
      key: "rotation",
      align: "center",
      render: (_, record) => {
        const rot = deviceRotations[record.scid];
        if (!rot) return null;
        const isLandscape = rot.width >= rot.height;
        return (
          <Tag color={isLandscape ? "green" : "blue"}>
            {isLandscape
              ? t("devices.controlledDevices.landscape")
              : t("devices.controlledDevices.portrait")}
          </Tag>
        );
      },
    },
    {
      title: "键盘映射",
      key: "mapping",
      align: "center",
      render: () => <MappingSelectCell mappingList={mappingList} />,
    },
    {
      title: t("devices.controlledDevices.action"),
      key: "action",
      align: "center",
      render: (_, record) => (
        <Space size="middle">
          <Button
            type="primary"
            danger
            icon={<DisconnectOutlined />}
            onClick={() => decontrolDevice(record.device_id)}
          >
            断开
          </Button>
          <Button
            icon={<PlayCircleOutlined />}
            onClick={() => {
              setScriptModalDevice(record);
              setScriptText("");
              setScriptOutput("");
            }}
          >
            输入脚本
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Table<ControlledDevice>
        rowKey={(record) => record.device_id}
        pagination={{ pageSize: 5 }}
        columns={columns}
        dataSource={controlledDevices}
      />
      <Modal
        title={`输入脚本 - ${scriptModalDevice?.device_id ?? ""}`}
        open={scriptModalDevice !== null}
        onCancel={() => setScriptModalDevice(null)}
        footer={null}
        width={700}
      >
        <Space direction="vertical" size="middle" className="w-full">
          <Input.TextArea
            rows={6}
            placeholder="逐行输入 adb shell 命令，如：&#10;input tap 500 1000&#10;input swipe 300 500 300 100&#10;input text hello"
            value={scriptText}
            onChange={(e) => setScriptText(e.target.value)}
          />
          <Flex gap="small">
            <Button
              type="primary"
              loading={scriptRunning}
              onClick={executeScript}
              disabled={!scriptText.trim()}
            >
              执行
            </Button>
            <Button onClick={() => setScriptOutput("")}>
              清空输出
            </Button>
          </Flex>
          {scriptOutput && (
            <Input.TextArea
              rows={8}
              readOnly
              value={scriptOutput}
              style={{ fontFamily: "monospace", fontSize: 12 }}
            />
          )}
        </Space>
      </Modal>
    </>
  );
}

function PendingDevices({
  otherDevices,
}: {
  otherDevices: AdbDevice[];
}) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const messageApi = useMessageContext();

  async function controlDevice(device: AdbDevice) {
    dispatch(setIsLoading(true));
    try {
      const res = await requestPost("/api/device/control_device", {
        device_id: device.id,
        video: true,
        audio: true,
      });
      messageApi?.success(res.message);
    } catch (error) {
      messageApi?.error(error as string);
    }
    dispatch(setIsLoading(false));
  }

  const columns: TableProps<AdbDevice>["columns"] = [
    {
      title: "ID",
      dataIndex: "id",
      key: "id",
    },
    {
      title: t("devices.otherDevices.status"),
      dataIndex: "status",
      key: "status",
    },
    {
      title: t("devices.otherDevices.action"),
      key: "action",
      align: "center",
      render: (_, record) => (
        <Button
          type="primary"
          icon={<SyncOutlined />}
          onClick={() => controlDevice(record)}
        >
          控制
        </Button>
      ),
    },
  ];

  return (
    <Table<AdbDevice>
      rowKey={(record) => record.id}
      pagination={{ pageSize: 5 }}
      columns={columns}
      dataSource={otherDevices}
    />
  );
}

export default function Devices() {
  const { t } = useTranslation();
  const messageApi = useMessageContext();
  const dispatch = useAppDispatch();
  const location = useLocation();

  const controlledDevices = useAppSelector(
    (state) => state.other.controlledDevices,
  );
  const adbDevices = useAppSelector((state) => state.other.adbDevices);
  const otherDevices = useMemo(() => {
    const controlledIdSet = new Set(controlledDevices.map((d) => d.device_id));
    return adbDevices.filter((d) => !controlledIdSet.has(d.id));
  }, [controlledDevices, adbDevices]);

  useEffect(() => {
    if (location.pathname === "/devices") refreshDevices();
  }, [location.pathname]);

  async function refreshDevices() {
    dispatch(setIsLoading(true));
    try {
      const res = await requestGet<{
        controlled_devices: ControlledDevice[];
        adb_devices: AdbDevice[];
      }>("/api/device/device_list");
      dispatch(setControlledDevices(res.data.controlled_devices));
      dispatch(setAdbDevices(res.data.adb_devices));
      messageApi?.success(res.message);
    } catch (error) {
      messageApi?.error(error as string);
    }
    dispatch(setIsLoading(false));
  }

  async function restartAdbServer() {
    dispatch(setIsLoading(true));
    try {
      const res = await requestPost<{
        controlled_devices: ControlledDevice[];
        adb_devices: AdbDevice[];
      }>("/api/device/adb_restart");
      dispatch(setControlledDevices(res.data.controlled_devices));
      dispatch(setAdbDevices(res.data.adb_devices));
      messageApi?.success(res.message);
    } catch (error) {
      messageApi?.error(error as string);
    }
    dispatch(setIsLoading(false));
  }

  return (
    <div className="page-container">
      <section>
        <h2 className="title-with-line">ADB 设备</h2>
        <ItemBoxContainer className="mb-6">
          <ItemBox label="ADB 服务">
            <Flex gap="small" align="center">
              <Button
                type="primary"
                icon={<ReloadOutlined />}
                onClick={restartAdbServer}
              >
                {t("devices.adbTools.server.restart")}
              </Button>
              <span className="text-sm text-color-secondary">
                {t("devices.otherDevices.title")} ({adbDevices.length} 台设备)
              </span>
            </Flex>
          </ItemBox>
        </ItemBoxContainer>
      </section>
      <section>
        <Flex justify="space-between" align="start">
          <h2 className="title-with-line">待控设备</h2>
          <Button
            type="primary"
            icon={<SyncOutlined />}
            onClick={() => refreshDevices()}
          >
            {t("devices.common.refresh")}
          </Button>
        </Flex>
        <PendingDevices otherDevices={otherDevices} />
      </section>
      <section className="mt-4">
        <Flex justify="space-between" align="start">
          <h2 className="title-with-line">受控设备</h2>
        </Flex>
        <ControlledDevices />
      </section>
    </div>
  );
}