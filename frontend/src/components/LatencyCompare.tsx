import { useState, useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, Flex, Typography, Upload, Alert, Switch } from "antd";
import { useAppDispatch, useAppSelector } from "../store/store";
import { setTouchProbeEnabled } from "../store/localConfig";
import {
  CloudUploadOutlined,
  PhoneOutlined,
  MonitorOutlined,
  DoubleRightOutlined,
} from "@ant-design/icons";
import axios from "axios";
import { requestUpload } from "../utils";

// 通过 POST 获取 blob + 自定义 header（路径 + 时间戳）
async function fetchBlobWithHeader(
  url: string,
): Promise<{
  blob: Blob;
  header: string;
  phoneTsBefore?: number;
  phoneTsAfter?: number;
  pcTsBefore?: number;
}> {
  const res = await axios.post(url, {}, { responseType: "blob" });
  const header =
    res.headers["x-phone-path"] ?? res.headers["x-pc-path"] ?? "";
  const num = (k: string) => {
    const v = res.headers[k];
    return v ? Number(v) : undefined;
  };
  return {
    blob: res.data,
    header,
    phoneTsBefore: num("x-phone-ts-before"),
    phoneTsAfter: num("x-phone-ts-after"),
    pcTsBefore: num("x-pc-ts-before"),
  };
}

export default function LatencyCompare() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const touchProbeEnabled = useAppSelector(
    (state) => state.localConfig.touchProbeEnabled,
  );
  // 手机截图
  const [phoneImg, setPhoneImg] = useState<string>("");
  const [phonePath, setPhonePath] = useState<string>("");
  // 窗口截图
  const [windowImg, setWindowImg] = useState<string>("");
  const [pcPath, setPcPath] = useState<string>("");
  // 上传图（电脑截图）
  const [uploadedUrl, setUploadedUrl] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<string>("");

  // 手机截屏：手机系统 screencap，保存到手机 + 拉回 PC 展示
  const handlePhoneScreenshot = useCallback(async () => {
    setLoading("phone");
    setError("");
    try {
      const { blob, header } = await fetchBlobWithHeader(
        "/api/device/adb_save_screenshot",
      );
      setPhoneImg(URL.createObjectURL(blob));
      setPhonePath(header);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading("");
    }
  }, []);

  // 窗口截屏：PC 端 scrcpy 窗口，保存到 PC + 载入 web 页面展示
  const handleWindowScreenshot = useCallback(async () => {
    setLoading("window");
    setError("");
    try {
      const { blob, header } = await fetchBlobWithHeader(
        "/api/device/window_screenshot",
      );
      setWindowImg(URL.createObjectURL(blob));
      setPcPath(header);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading("");
    }
  }, []);

  // 同时截取：并行触发手机截屏(保存到手机) + 截取投屏窗口，两张图同时展示对比
  const handleBothScreenshot = useCallback(async () => {
    setLoading("both");
    setError("");
    try {
      const [phone, win] = await Promise.all([
        fetchBlobWithHeader("/api/device/adb_save_screenshot"),
        fetchBlobWithHeader("/api/device/window_screenshot"),
      ]);
      setPhoneImg(URL.createObjectURL(phone.blob));
      setPhonePath(phone.header);
      setWindowImg(URL.createObjectURL(win.blob));
      setPcPath(win.header);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading("");
    }
  }, []);

  // 上传图片（电脑截图/手机拉取的图）用于对比观察
  const handleUpload = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append("image", file);
    setLoading("upload");
    setError("");
    try {
      const res = await requestUpload<{ url?: string }>("/api/upload/upload", formData);
      setUploadedUrl(res.data?.url ?? "");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading("");
    }
    return false; // 阻止 antd 默认上传
  }, []);

  const ImgBox = ({
    title,
    src,
    pathLabel,
    path,
    children,
  }: {
    title: string;
    src: string;
    pathLabel?: string;
    path?: string;
    children?: ReactNode;
  }) => (
    <Flex vertical gap={10} style={{ flex: 1, minWidth: 280 }}>
      <Typography.Text strong>{title}</Typography.Text>
      <div
        style={{
          border: "1px solid #333",
          borderRadius: 6,
          overflow: "hidden",
          background: "#000",
          minHeight: 220,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {src ? (
          <img src={src} alt={title} style={{ width: "100%", display: "block" }} />
        ) : (
          <Typography.Text type="secondary">{t("latencyCompare.noImage")}</Typography.Text>
        )}
      </div>
      {children}
      {pathLabel && path && (
        <Typography.Text type="secondary" style={{ wordBreak: "break-all" }}>
          {pathLabel} {path}
        </Typography.Text>
      )}
    </Flex>
  );

  return (
    <div className="page-container hide-scrollbar">
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {t("latencyCompare.title")}
      </Typography.Title>

      {/* 屏幕性能监控：perf.jsonl（投屏链路各环节耗时探针） */}
      <Alert
        type="info"
        showIcon
        message={
          <Flex vertical gap={2}>
            <Typography.Text strong>
              {t("latencyCompare.screenPerfTitle")}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("latencyCompare.screenPerfDesc")}
            </Typography.Text>
          </Flex>
        }
        style={{ marginBottom: 16 }}
      />

      {/* 映射性能监控：touch_probe.jsonl（注入手机的触摸事件流探针） */}
      <Alert
        type="warning"
        showIcon
        message={
          <Flex align="center" gap={12} justify="space-between" wrap>
            <Flex vertical gap={2} style={{ flex: 1, minWidth: 240 }}>
              <Typography.Text strong>
                {t("latencyCompare.touchProbeEnabled")}
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t("latencyCompare.touchProbeDesc")}
              </Typography.Text>
            </Flex>
            <Switch
              checked={touchProbeEnabled}
              onChange={(v) => dispatch(setTouchProbeEnabled(v))}
              checkedChildren={t("latencyCompare.touchProbeOn")}
              unCheckedChildren={t("latencyCompare.touchProbeOff")}
            />
          </Flex>
        }
        style={{ marginBottom: 16 }}
      />

      {/* 预览参考说明 */}
      <Alert
        type="info"
        showIcon
        message={t("latencyCompare.previewNotice")}
        style={{ marginBottom: 16 }}
      />

      {error && (
        <Alert
          type="error"
          message={error}
          showIcon
          closable
          onClose={() => setError("")}
          style={{ marginBottom: 12 }}
        />
      )}

      {/* 同时截取按钮：并行触发手机截屏 + 窗口截图 */}
      <Flex style={{ marginBottom: 16 }}>
        <Button
          type="primary"
          icon={<DoubleRightOutlined />}
          onClick={handleBothScreenshot}
          loading={loading === "both"}
        >
          {t("latencyCompare.captureBoth")}
        </Button>
      </Flex>

      {/* 显眼注释：以下两张截图仅作参考，真正测延迟需用另一台手机拍摄两个屏幕对比 */}
      <Alert
        type="warning"
        showIcon
        message={t("latencyCompare.measureTip")}
        description={t("latencyCompare.measureTipDetail")}
        style={{ marginBottom: 16 }}
      />

      {/* 详细探针延迟引导：截图对比只能感知整体延迟，细分延迟需自配 perf_monitor */}
      <Alert
        type="info"
        showIcon
        message={t("latencyCompare.perfMonitorGuideTitle")}
        description={
          <div style={{ whiteSpace: "pre-line" }}>
            {t("latencyCompare.perfMonitorGuideDetail")}
          </div>
        }
        style={{ marginBottom: 16 }}
      />

      {/* 左右结构：左=手机，右=窗口 */}
      <Flex gap={16} wrap>
        {/* 左栏：手机截图 */}
        <ImgBox
          title={t("latencyCompare.phoneCard")}
          src={phoneImg}
          pathLabel={t("latencyCompare.phonePath")}
          path={phonePath}
        >
          <Flex gap={8}>
            <Button
              icon={<PhoneOutlined />}
              onClick={handlePhoneScreenshot}
              loading={loading === "phone"}
            >
              {t("latencyCompare.saveToPhone")}
            </Button>
            <Upload accept="image/*" showUploadList={false} beforeUpload={handleUpload}>
              <Button icon={<CloudUploadOutlined />} loading={loading === "upload"}>
                {t("latencyCompare.uploadImage")}
              </Button>
            </Upload>
          </Flex>
        </ImgBox>

        {/* 右栏：窗口截图 */}
        <ImgBox
          title={t("latencyCompare.windowCard")}
          src={windowImg}
          pathLabel={t("latencyCompare.pcPath")}
          path={pcPath}
        >
          <Button
            icon={<MonitorOutlined />}
            onClick={handleWindowScreenshot}
            loading={loading === "window"}
          >
            {t("latencyCompare.captureWindow")}
          </Button>
        </ImgBox>
      </Flex>

      {/* 上传的电脑截图展示 */}
      {uploadedUrl && (
        <div style={{ marginTop: 16 }}>
          <Typography.Text strong>{t("latencyCompare.uploadedTitle")}</Typography.Text>
          <img
            src={uploadedUrl}
            alt={t("latencyCompare.uploadedTitle")}
            style={{
              maxWidth: "100%",
              border: "1px solid #333",
              borderRadius: 6,
              marginTop: 8,
            }}
          />
        </div>
      )}
    </div>
  );
}
