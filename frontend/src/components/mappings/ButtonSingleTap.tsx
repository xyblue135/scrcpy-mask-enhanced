import { useEffect, useMemo, useState } from "react";
import type { MappingUpdater, SingleTapConfig } from "./mapping";
import { Flex, InputNumber, Switch, Tooltip, Typography } from "antd";
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
import {
  MappingOverlayCircle,
  type MappingOverlayCircleShape,
} from "./MappingOverlay";
import { useMappingRandomRangeVisible } from "./MappingOverlayContext";

export default function ButtonSingleTap({
  index,
  config,
  originalSize,
  onConfigChange,
  onConfigDelete,
  onConfigCopy,
}: {
  index: number;
  config: SingleTapConfig;
  originalSize: { width: number; height: number };
  onConfigChange: MappingUpdater<SingleTapConfig>;
  onConfigDelete: () => void;
  onConfigCopy: () => void;
}) {
  const id = `mapping-single-tap-${index}`;
  const isLongPress = config.long_press ?? false;
  const bindText = config.bind.length > 0 ? config.bind.join("+") : "???";
  const className =
    "rounded-full absolute box-border border-solid border-2 color-text " +
    (config.bind.length > 0
      ? "border-text-secondary hover:border-text"
      : "border-primary hover:border-primary-hover");

  const maskArea = useAppSelector((state) => state.other.maskArea);
  const mappingButtonScale = useAppSelector((state) => state.localConfig.mappingButtonScale);
  const [showSetting, setShowSetting] = useState(false);

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

  useEffect(() => {
    const element = document.getElementById(id);
    if (element) {
      element.style.transform = mappingButtonTransformStyle(
        config.position.x,
        config.position.y,
        scale
      );
    }
  }, [index, config, scale]);

  const handleDrag = mappingButtonDragFactory(
    maskArea,
    originalSize,
    ({ x, y }) => {
      onConfigChange({
        ...config,
        position: {
          x,
          y,
        },
      });
    }
  );

  const handleSetting = (e: React.MouseEvent) => {
    e.preventDefault();
    setShowSetting(true);
  };

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
      >
        <Tooltip trigger="click" title={`${config.stealth_mode ? "StealthTap" : isLongPress ? "LongPress" : config.type}: ${bindText}`}>
          <Typography.Text ellipsis={true} className="text-2.5 font-bold">
            {bindText}
          </Typography.Text>
        </Tooltip>
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
  config: SingleTapConfig;
  onConfigChange: MappingUpdater<SingleTapConfig>;
  onConfigDelete: () => void;
  onConfigCopy: () => void;
}) {
  const { t } = useTranslation();
  const isLongPress = config.long_press ?? false;

  return (
    <div>
      <h1 className="title-with-line">
        {t(
          config.stealth_mode
            ? "mappings.stealthTap.setting.title"
            : isLongPress
              ? "mappings.longPress.setting.title"
              : "mappings.singleTap.setting.title"
        )}
      </h1>
      <ItemBoxContainer className="max-h-70vh overflow-y-auto pr-2 scrollbar">
        <SettingMappingId id={config.id} />
        <SettingBind
          label={
            config.stealth_mode
              ? t("mappings.stealthTap.setting.triggerKey")
              : undefined
          }
          tooltip={
            config.stealth_mode
              ? t("mappings.stealthTap.setting.triggerKeyHint")
              : undefined
          }
          bind={config.bind}
          onBindChange={(bind) => onConfigChange((pre) => ({ ...pre, bind }))}
        />
        <SettingPointerId
          pointerId={config.pointer_id}
          onPointerIdChange={(pointerId) =>
            onConfigChange({ ...config, pointer_id: pointerId })
          }
        />
        {!config.stealth_mode && !isLongPress && (
          <ItemBox label={t("mappings.singleTap.setting.sync")} tooltip={t("mappings.singleTap.setting.syncHint")}>
            <Switch
              checked={config.sync}
              onChange={(v) => {
                onConfigChange({ ...config, sync: v });
              }}
            />
          </ItemBox>
        )}
        {!config.stealth_mode && !config.sync && (
          <ItemBox
            label={
              isLongPress
                ? t("mappings.longPress.setting.duration")
                : t("mappings.singleTap.setting.duration")
            }
            tooltip={
              isLongPress
                ? t("mappings.longPress.setting.durationHint")
                : t("mappings.singleTap.setting.durationHint")
            }
          >
            <InputNumber
              className="w-full"
              value={config.duration}
              min={0}
              onChange={(v) =>
                v !== null && onConfigChange({ ...config, duration: v })
              }
            />
          </ItemBox>
        )}
        {config.stealth_mode && (
          <SettingBind
            label={t("mappings.stealthTap.setting.cancelKeys")}
            tooltip={t("mappings.stealthTap.setting.cancelKeysHint")}
            bind={config.cancel_bind ?? []}
            onBindChange={(cancel_bind) =>
              onConfigChange((pre) => ({ ...pre, cancel_bind }))
            }
          />
        )}
        <ItemBox label={t("mappings.common.randomOffsetX")} tooltip={t("mappings.common.randomOffsetXHint")}>
          <InputNumber
            className="w-full"
            value={config.random_offset_x}
            min={0}
            onChange={(v) =>
              v !== null && onConfigChange({ ...config, random_offset_x: v })
            }
          />
        </ItemBox>
        <ItemBox label={t("mappings.common.randomOffsetY")} tooltip={t("mappings.common.randomOffsetYHint")}>
          <InputNumber
            className="w-full"
            value={config.random_offset_y}
            min={0}
            onChange={(v) =>
              v !== null && onConfigChange({ ...config, random_offset_y: v })
            }
          />
        </ItemBox>
        <SettingNote
          note={config.note}
          onNoteChange={(note) => onConfigChange({ ...config, note })}
        />
        {!config.stealth_mode && (
          <SettingScriptHooks
            scriptHooks={config.script_hooks}
            onScriptHooksChange={(script_hooks) =>
              onConfigChange({ ...config, script_hooks })
            }
          />
        )}
        <SettingFooter onDelete={onConfigDelete} onCopy={onConfigCopy} />
      </ItemBoxContainer>
    </div>
  );
}
