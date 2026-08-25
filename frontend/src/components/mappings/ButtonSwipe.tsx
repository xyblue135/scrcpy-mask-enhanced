import { useEffect, useMemo, useState } from "react";
import type { MappingUpdater, SwipeConfig } from "./mapping";
import { Flex, InputNumber, Space, Switch, Tooltip, Typography } from "antd";
import {
  mappingButtonDragFactory,
  mappingButtonPosition,
  mappingButtonScaledPresetStyle,
  mappingButtonTransformStyle,
} from "./tools";
import { useAppSelector } from "../../store/store";
import { ItemBoxContainer, ItemBox } from "../common/ItemBox";
import {
  SettingBind,
  SettingFooter,
  SettingMappingId,
  SettingModal,
  SettingNote,
  SettingPointerId,
  SettingScriptHooks,
} from "./Common";
import { useTranslation } from "react-i18next";
import { IconFont } from "../../hooks";
import {
  MappingOverlayPolyline,
  type MappingOverlayPoint,
} from "./MappingOverlay";
import { useMappingGuideState } from "./MappingOverlayContext";

type Position = { x: number; y: number };

export default function ButtonSwipe({
  index,
  config,
  originalSize,
  onConfigChange,
  onConfigDelete,
  onConfigCopy,
}: {
  index: number;
  config: SwipeConfig;
  originalSize: { width: number; height: number };
  onConfigChange: MappingUpdater<SwipeConfig>;
  onConfigDelete: () => void;
  onConfigCopy: () => void;
}) {
  const id = `mapping-single-tap-${index}`;
  const bindText = config.bind.length > 0 ? config.bind.join("+") : "???";
  const className =
    "rounded-full absolute box-border border-solid border-2 color-text " +
    (config.bind.length > 0
      ? "border-text-secondary hover:border-text"
      : "border-primary hover:border-primary-hover");

  const maskArea = useAppSelector((state) => state.other.maskArea);
  const [showSetting, setShowSetting] = useState(false);
  const mappingGuide = useMappingGuideState(showSetting);
  const mappingButtonScale = useAppSelector((state) => state.localConfig.mappingButtonScale);

  const scale = useMemo(() => {
    return {
      x: maskArea.width / originalSize.width,
      y: maskArea.height / originalSize.height,
    };
  }, [originalSize, maskArea]);

  const buttonStyle = useMemo(
    () => mappingButtonScaledPresetStyle(52, maskArea, undefined, mappingButtonScale),
    [maskArea, mappingButtonScale],
  );

  const tracePoints = useMemo<MappingOverlayPoint[]>(() => {
    return config.positions.map((position) =>
      mappingButtonPosition(position.x, position.y, scale),
    );
  }, [config.positions, scale]);

  useEffect(() => {
    const element = document.getElementById(id);
    if (element) {
      const position = config.positions[0] ?? { x: 0, y: 0 };
      element.style.transform = mappingButtonTransformStyle(
        position.x,
        position.y,
        scale
      );
    }
  }, [index, config, scale]);

  const handleDrag = mappingButtonDragFactory(
    maskArea,
    originalSize,
    ({ x, y }) => {
      const positions = [
        { x, y },
        config.positions[1] ?? { x, y },
      ];
      onConfigChange({ ...config, positions });
    }
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    mappingGuide.startPointerDown(e);
    handleDrag(e);
  };

  const handleSetting = (e: React.MouseEvent) => {
    e.preventDefault();
    setShowSetting(true);
  };

  return (
    <>
      <SettingModal open={showSetting} onClose={() => setShowSetting(false)}>
        <Setting
          config={config}
          onConfigChange={onConfigChange}
          onConfigDelete={() => {
            setShowSetting(false);
            onConfigDelete();
          }}
          onConfigCopy={() => {
            setShowSetting(false);
            onConfigCopy();
          }}
        />
      </SettingModal>
      <MappingOverlayPolyline
        points={tracePoints}
        visible={mappingGuide.visible}
        tone="trace"
        showLabels
      />
      <Flex
        id={id}
        style={buttonStyle}
        className={className}
        onMouseDown={handleMouseDown}
        onContextMenu={handleSetting}
        {...mappingGuide.interactionProps}
        justify="center"
        align="center"
        vertical
      >
        <Tooltip trigger="click" title={`${config.type}: ${bindText}`}>
          <Typography.Text ellipsis={true} className="text-2.5 font-bold">
            {bindText}
          </Typography.Text>
        </Tooltip>
        <IconFont type="icon-trace" className="text-4" />
      </Flex>
    </>
  );
}

function Setting({
  config,
  onConfigChange,
  onConfigDelete,
  onConfigCopy,
}: {
  config: SwipeConfig;
  onConfigChange: MappingUpdater<SwipeConfig>;
  onConfigDelete: () => void;
  onConfigCopy: () => void;
}) {
  const { t } = useTranslation();

  function setPoint(index: 0 | 1, axis: "x" | "y", value: number | null) {
    if (value === null) return;
    const start = config.positions[0] ?? { x: 0, y: 0 };
    const end = config.positions[1] ?? start;
    const positions: Position[] = [start, end];
    positions[index] = { ...positions[index], [axis]: value };
    onConfigChange({ ...config, positions });
  }

  const start = config.positions[0] ?? { x: 0, y: 0 };
  const end = config.positions[1] ?? start;

  return (
    <div>
      <h1 className="title-with-line">{t("mappings.swipe.setting.title")}</h1>
      <ItemBoxContainer className="max-h-70vh overflow-y-auto pr-2 scrollbar">
        <SettingMappingId id={config.id} />
        <SettingBind
          bind={config.bind}
          onBindChange={(bind) => onConfigChange((pre) => ({ ...pre, bind }))}
        />
        <SettingPointerId
          pointerId={config.pointer_id}
          onPointerIdChange={(pointerId) =>
            onConfigChange({ ...config, pointer_id: pointerId })
          }
        />
        <ItemBox label={t("mappings.swipe.setting.start")} tooltip={t("mappings.swipe.setting.startHint")}>
          <Space.Compact className="w-full">
            <InputNumber
              className="w-full"
              addonBefore="X"
              value={start.x}
              onChange={(v) => setPoint(0, "x", v)}
            />
            <InputNumber
              className="w-full"
              addonBefore="Y"
              value={start.y}
              onChange={(v) => setPoint(0, "y", v)}
            />
          </Space.Compact>
        </ItemBox>
        <ItemBox label={t("mappings.swipe.setting.end")} tooltip={t("mappings.swipe.setting.endHint")}>
          <Space.Compact className="w-full">
            <InputNumber
              className="w-full"
              addonBefore="X"
              value={end.x}
              onChange={(v) => setPoint(1, "x", v)}
            />
            <InputNumber
              className="w-full"
              addonBefore="Y"
              value={end.y}
              onChange={(v) => setPoint(1, "y", v)}
            />
          </Space.Compact>
        </ItemBox>
        <ItemBox label={t("mappings.swipe.setting.bezierWave")} tooltip={t("mappings.swipe.setting.bezierWaveHint")}>
          <Switch
            checked={config.bezier_wave}
            onChange={(bezier_wave) =>
              onConfigChange({ ...config, bezier_wave })
            }
          />
        </ItemBox>
        <ItemBox label={t("mappings.swipe.setting.duration")} tooltip={t("mappings.swipe.setting.durationHint")}>
          <InputNumber
            className="w-full"
            value={config.duration}
            min={0}
            onChange={(v) =>
              v !== null && onConfigChange({ ...config, duration: v })
            }
          />
        </ItemBox>
        <ItemBox label={t("mappings.swipe.setting.enableRandomization")} tooltip={t("mappings.swipe.setting.enableRandomizationHint")}>
          <Switch
            checked={config.enable_randomization}
            onChange={(enable_randomization) =>
              onConfigChange({ ...config, enable_randomization })
            }
          />
        </ItemBox>
        <SettingNote
          note={config.note}
          onNoteChange={(note) => onConfigChange({ ...config, note })}
        />
        <SettingScriptHooks
          scriptHooks={config.script_hooks}
          onScriptHooksChange={(script_hooks) =>
            onConfigChange({ ...config, script_hooks })
          }
        />
        <SettingFooter onDelete={onConfigDelete} onCopy={onConfigCopy} />
      </ItemBoxContainer>
    </div>
  );
}
