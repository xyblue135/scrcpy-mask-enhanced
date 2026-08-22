import { useEffect, useMemo, useRef, useState } from "react";
import type { MappingUpdater, Position, WheelConfig } from "./mapping";
import {
  Button,
  Flex,
  InputNumber,
  Popover,
  Slider,
  Space,
  Switch,
  Tooltip,
  Typography,
} from "antd";
import {
  clientPositionToMappingPosition,
  mappingButtonDragFactory,
  mappingButtonPosition,
  mappingButtonScaledPresetStyle,
  mappingButtonTransformStyle,
} from "./tools";
import { useAppSelector } from "../../store/store";
import { ItemBoxContainer, ItemBox } from "../common/ItemBox";
import {
  CursorPos,
  DeviceBackground,
  RefreshImageButton,
  SettingBind,
  SettingFooter,
  SettingMappingId,
  SettingModal,
  SettingNote,
  SettingPointerId,
} from "./Common";
import { useTranslation } from "react-i18next";
import { RollbackOutlined } from "@ant-design/icons";
import { throttle } from "../../utils";
import {
  MappingOverlayCircle,
  type MappingOverlayCircleShape,
} from "./MappingOverlay";
import { useMappingRandomRangeVisible } from "./MappingOverlayContext";

const WHEEL_COLORS = [
  "#f5222d",
  "#fa8c16",
  "#faad14",
  "#a0d911",
  "#52c41a",
  "#13c2c2",
  "#1677ff",
  "#722ed1",
];

function wheelSectorPath(
  count: number,
  index: number,
  radius: number,
): string {
  const start = (index / count) * Math.PI * 2;
  const end = ((index + 1) / count) * Math.PI * 2;
  const rad = radius;
  const x1 = rad * Math.cos(start);
  const y1 = rad * Math.sin(start);
  const x2 = rad * Math.cos(end);
  const y2 = rad * Math.sin(end);
  return `M0,0 L${x1},${y1} A${rad},${rad} 0 0,1 ${x2},${y2} Z`;
}

export default function ButtonWheel({
  index,
  config,
  originalSize,
  onConfigChange,
  onConfigDelete,
  onConfigCopy,
}: {
  index: number;
  config: WheelConfig;
  originalSize: { width: number; height: number };
  onConfigChange: MappingUpdater<WheelConfig>;
  onConfigDelete: () => void;
  onConfigCopy: () => void;
}) {
  const id = `mapping-wheel-${index}`;
  const bindText = config.bind.length > 0 ? config.bind.join("+") : "???";
  const className =
    "rounded-full absolute box-border border-solid border-2 color-text " +
    (config.bind.length > 0
      ? "border-text-secondary hover:border-text"
      : "border-primary hover:border-primary-hover");

  const maskArea = useAppSelector((state) => state.other.maskArea);
  const [showSetting, setShowSetting] = useState(false);
  const mappingButtonScale = useAppSelector(
    (state) => state.localConfig.mappingButtonScale,
  );

  const scale = useMemo(() => {
    return {
      x: maskArea.width / originalSize.width,
      y: maskArea.height / originalSize.height,
    };
  }, [originalSize, maskArea]);

  const buttonStyle = useMemo(
    () =>
      mappingButtonScaledPresetStyle(64, maskArea, undefined, mappingButtonScale),
    [maskArea, mappingButtonScale],
  );

  const wheelRadiusShape = useMemo<MappingOverlayCircleShape>(() => {
    return {
      centerX: config.center.x * scale.x,
      centerY: config.center.y * scale.y,
      radius: config.radius * scale.y,
    };
  }, [config.radius, config.center, scale]);

  const showRandomRange = useMappingRandomRangeVisible(false);

  const randomRangeShape = useMemo<MappingOverlayCircleShape | null>(() => {
    const radius = Math.max(config.random_offset_x, config.random_offset_y);
    if (!showRandomRange || radius <= 0) return null;
    const center = mappingButtonPosition(config.position.x, config.position.y, scale);
    return {
      centerX: center.x,
      centerY: center.y,
      radius: Math.max(radius * Math.max(scale.x, scale.y), 6),
    };
  }, [showRandomRange, config.random_offset_x, config.random_offset_y, config.position, scale]);

  useEffect(() => {
    const element = document.getElementById(id);
    if (element) {
      element.style.transform = mappingButtonTransformStyle(
        config.position.x,
        config.position.y,
        scale,
      );
    }
  }, [index, config, scale]);

  const handleDrag = mappingButtonDragFactory(
    maskArea,
    originalSize,
    ({ x, y }) => {
      onConfigChange({
        ...config,
        position: { x, y },
      });
    },
  );

  const handleSetting = (e: React.MouseEvent) => {
    e.preventDefault();
    setShowSetting(true);
  };

  return (
    <>
      <SettingModal open={showSetting} onClose={() => setShowSetting(false)}>
        <Setting
          config={config}
          originalSize={originalSize}
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
      <MappingOverlayCircle
        shape={wheelRadiusShape}
        visible={showSetting}
        tone="drag"
      />
      <MappingOverlayCircle
        shape={randomRangeShape ?? { centerX: 0, centerY: 0, radius: 0 }}
        visible={randomRangeShape !== null}
        tone="boundary"
      />
      <Flex
        id={id}
        style={buttonStyle}
        className={className}
        onMouseDown={handleDrag}
        onContextMenu={handleSetting}
        justify="center"
        align="center"
        vertical
        gap={4}
      >
        <Tooltip trigger="click" title={`${config.type}: ${bindText}`}>
          <Typography.Text ellipsis={true} className="text-2.5 font-bold">
            {bindText}
          </Typography.Text>
        </Tooltip>
        <span className="text-primary text-xs leading-none">◎</span>
      </Flex>
    </>
  );
}

function WheelCenter({
  center,
  radius,
  count,
  maskArea,
  originalSize,
  onCenterChange,
  onRadiusChange,
}: {
  center: Position;
  radius: number;
  count: number;
  maskArea: { width: number; height: number; left: number; top: number };
  originalSize: { width: number; height: number };
  onCenterChange: (pos: Position) => void;
  onRadiusChange: (r: number) => void;
}) {
  const { t } = useTranslation();
  const handleDrag = mappingButtonDragFactory(
    maskArea,
    originalSize,
    (pos) => {
      onCenterChange(pos);
    },
    200,
  );

  const scale = {
    x: maskArea.width / originalSize.width,
    y: maskArea.height / originalSize.height,
  };
  const transform = mappingButtonTransformStyle(center.x, center.y, scale);
  const maskRadius = (radius / originalSize.height) * maskArea.height;

  return (
    <Popover
      trigger="contextMenu"
      content={
        <ItemBoxContainer>
          <ItemBox label={t("mappings.wheel.setting.center")}>
            <Space.Compact className="w-full">
              <InputNumber
                className="w-full"
                prefix="X:"
                value={center.x}
                min={0}
                onChange={(v) =>
                  v !== null && onCenterChange({ x: v, y: center.y })
                }
              />
              <InputNumber
                className="w-full"
                prefix="Y:"
                value={center.y}
                min={0}
                onChange={(v) =>
                  v !== null && onCenterChange({ x: center.x, y: v })
                }
              />
              <Button
                type="primary"
                onClick={() =>
                  onCenterChange({
                    x: originalSize.width / 2,
                    y: originalSize.height / 2,
                  })
                }
              >
                {t("mappings.wheel.setting.setCenter")}
              </Button>
            </Space.Compact>
          </ItemBox>
          <ItemBox label={t("mappings.wheel.setting.radius")}>
            <InputNumber
              className="w-full"
              value={radius}
              min={1}
              onChange={(v) => v !== null && onRadiusChange(v)}
            />
          </ItemBox>
        </ItemBoxContainer>
      }
    >
      <g onMouseDown={handleDrag} style={{ transform }}>
        <circle
          cx="0"
          cy="0"
          r={maskRadius}
          stroke="var(--ant-color-primary)"
          fill="none"
          strokeWidth="2"
        />
        {Array.from({ length: Math.max(count, 1) }).map((_, i) => (
          <path
            key={i}
            d={wheelSectorPath(Math.max(count, 1), i, maskRadius)}
            fill={WHEEL_COLORS[i % WHEEL_COLORS.length]}
            style={{ opacity: 0.35 }}
          />
        ))}
      </g>
    </Popover>
  );
}

function WheelEditor({
  config,
  originalSize,
  onExit,
  onChange,
}: {
  config: WheelConfig;
  originalSize: { width: number; height: number };
  onExit: () => void;
  onChange: (config: WheelConfig) => void;
}) {
  const { t } = useTranslation();
  const maskArea = useAppSelector((state) => state.other.maskArea);
  const cursorPosRef = useRef<HTMLDivElement>(null);
  const handleMouseMove = throttle((e: React.MouseEvent) => {
    if (cursorPosRef.current) {
      const { x, y } = clientPositionToMappingPosition(
        e.clientX,
        e.clientY,
        maskArea,
        originalSize.width,
        originalSize.height,
      );
      cursorPosRef.current.innerText = `(${x},${y})`;
    }
  }, 100);

  return (
    <div className="select-none fixed left-0 top-0 right-0 bottom-0 bg-[var(--ant-color-bg-mask)] z-2000">
      <Space.Compact className="absolute top-8 right-8 z--1">
        <RefreshImageButton />
        <Button type="primary" icon={<RollbackOutlined />} onClick={() => onExit()}>
          {t("mappings.wheel.setting.back")}
        </Button>
      </Space.Compact>
      <div
        className="absolute border border-solid border-primary"
        style={{
          left: maskArea.left - 1,
          top: maskArea.top - 1,
          width: maskArea.width,
          height: maskArea.height,
        }}
      >
        <DeviceBackground alpha={0} />
        <div className="w-full h-full absolute" onMouseMove={handleMouseMove}>
          <CursorPos ref={cursorPosRef} className="absolute top--6" />
          <div className="color-text-secondary font-bold absolute top--6 right-0">
            {`[${originalSize.width} x ${originalSize.height}]`}
          </div>
          <svg className="w-full h-full">
            <WheelCenter
              center={config.center}
              radius={config.radius}
              count={config.count}
              maskArea={maskArea}
              originalSize={originalSize}
              onCenterChange={(center) => onChange({ ...config, center })}
              onRadiusChange={(radius) => onChange({ ...config, radius })}
            />
          </svg>
        </div>
      </div>
    </div>
  );
}

function Setting({
  config,
  originalSize,
  onConfigChange,
  onConfigDelete,
  onConfigCopy,
}: {
  config: WheelConfig;
  originalSize: { width: number; height: number };
  onConfigChange: MappingUpdater<WheelConfig>;
  onConfigDelete: () => void;
  onConfigCopy: () => void;
}) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div>
      <h1 className="title-with-line">{t("mappings.wheel.setting.title")}</h1>
      {isEditing && (
        <WheelEditor
          config={config}
          originalSize={originalSize}
          onExit={() => setIsEditing(false)}
          onChange={(c) => onConfigChange(c)}
        />
      )}
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
        <ItemBox label={t("mappings.wheel.setting.radius")}>
          <InputNumber
            className="w-full"
            value={config.radius}
            min={1}
            onChange={(v) => v !== null && onConfigChange({ ...config, radius: v })}
          />
        </ItemBox>
        <ItemBox label={t("mappings.wheel.setting.count")}>
          <Slider
            min={1}
            max={8}
            onChange={(v) => onConfigChange({ ...config, count: v })}
            value={config.count}
          />
        </ItemBox>
        <ItemBox label={t("mappings.directionPad.setting.initDuration")}>
          <InputNumber
            className="w-full"
            value={config.initial_duration}
            min={0}
            onChange={(v) =>
              v !== null && onConfigChange({ ...config, initial_duration: v })
            }
          />
        </ItemBox>
        <ItemBox label={t("mappings.wheel.setting.enableRandomization")}>
          <Switch
            checked={config.enable_randomization}
            onChange={(enable_randomization) =>
              onConfigChange({ ...config, enable_randomization })
            }
          />
        </ItemBox>
        <ItemBox label={t("mappings.common.randomOffsetX")}>
          <InputNumber
            className="w-full"
            value={config.random_offset_x}
            min={0}
            onChange={(v) =>
              v !== null && onConfigChange({ ...config, random_offset_x: v })
            }
          />
        </ItemBox>
        <ItemBox label={t("mappings.common.randomOffsetY")}>
          <InputNumber
            className="w-full"
            value={config.random_offset_y}
            min={0}
            onChange={(v) =>
              v !== null && onConfigChange({ ...config, random_offset_y: v })
            }
          />
        </ItemBox>
        <ItemBox label={t("mappings.wheel.setting.editLabel")}>
          <Button type="dashed" onClick={() => setIsEditing(true)}>
            {t("mappings.wheel.setting.edit")}
          </Button>
        </ItemBox>
        <SettingNote
          note={config.note}
          onNoteChange={(note) => onConfigChange({ ...config, note })}
        />
        <SettingFooter onDelete={onConfigDelete} onCopy={onConfigCopy} />
      </ItemBoxContainer>
    </div>
  );
}
