import { Card, Flex, Typography } from "antd";
import { useTranslation } from "react-i18next";

/**
 * 侧边栏"使用说明"模块：把内容拆成多个 i18n section，按顺序渲染成多张卡片。
 * 这样新增/调整说明只需要修改翻译文件，不需要动组件结构。
 *
 * i18n 字段约定（usageGuide.<key>.title / usageGuide.<key>.content）：
 *   intro           顶部总览/适用人群
 *   quickStart      首次使用的 4 步流程
 *   devices         设备页：ADB 工具 / 无线配对 / 启动控制
 *   scrcpyPresets   Scrcpy 预设页：分辨率/码率/FPS/虚拟显示
 *   mappings        映射页：按键 / 触摸 / FPS / 施法 / 脚本
 *   deviceParams    设备参数：启动时大小 / ADB 分辨率 / ADB 包列表
 *   latencyCompare  性能监测和延迟对比：perf.jsonl / touch_probe.jsonl
 *   settings        设置页：基本/视频/音频/蒙版/高级
 *   tips            常见坑 / 性能调优 / 调试建议
 */
const SECTIONS: string[] = [
  "intro",
  "quickStart",
  "devices",
  "scrcpyPresets",
  "mappings",
  "deviceParams",
  "latencyCompare",
  "settings",
  "tips",
];

export default function UsageGuide() {
  const { t } = useTranslation();

  return (
    // 用 page-container 包一层：自带 overflow-y: auto + 6px 自定义滚动条样式，
    // 当章节内容超出视窗时自动出下拉条；height: 0 + flex-grow: 1 让滚动容器
    // 正确填充 Sider 剩余的高度，不会把整个页面顶出 viewport。
    <div className="page-container">
      <Flex vertical gap={16} className="w-full max-w-none">
        <Card title={t("usageGuide.title")} bordered={false}>
          <Typography.Paragraph
            type="secondary"
            // 移除 whiteSpace 强制 pre-line，避免长段无 \n 时不换行溢出
            style={{ marginBottom: 0 }}
          >
            {t("usageGuide.subtitle")}
          </Typography.Paragraph>
        </Card>

        {SECTIONS.map((key) => {
          const contentPath = `usageGuide.${key}.content`;
          const titlePath = `usageGuide.${key}.title`;
          const content = t(contentPath);
          const title = t(titlePath);
          // i18n 缺失时回退到 key 字符串，避免渲染 "undefined" 之类的
          if (!content || content === contentPath) {
            return null;
          }
          return (
            <Card key={key} title={title} className="w-full">
              {/* 保持 whiteSpace: pre-line：内容里手工 \n 的列表 / 缩进生效，
                  但单行超长时仍走父容器 word-break: break-word 自然换行 */}
              <Typography.Paragraph
                style={{
                  whiteSpace: "pre-line",
                  marginBottom: 0,
                  wordBreak: "break-word",
                  overflowWrap: "anywhere",
                }}
              >
                {content}
              </Typography.Paragraph>
            </Card>
          );
        })}
      </Flex>
    </div>
  );
}
