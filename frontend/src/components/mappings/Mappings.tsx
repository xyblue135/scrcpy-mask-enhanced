import {
  type DirectionBinding,
  type MappingConfig,
  type MappingType,
  newMappingId,
  normalizeMappingConfig,
} from "./mapping";
import * as MappingConstructor from "./mapping";

import {
  Alert,
  Badge,
  Button,
  Dropdown,
  Flex,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Popconfirm,
  Select,
  Space,
  Splitter,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  type TableProps,
} from "antd";
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import { useAppDispatch, useAppSelector } from "../../store/store";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  LockOutlined,
  UnlockOutlined,
  ThunderboltOutlined,
  FileAddOutlined,
  FileSyncOutlined,
  FileTextOutlined,
  RollbackOutlined,
  SaveOutlined,
  SettingOutlined,
  SnippetsOutlined,
  KeyOutlined,
  SwapOutlined,
  EyeInvisibleOutlined,
} from "@ant-design/icons";
import IconButton from "../common/IconButton";
import {
  type ApiError,
  deepClone,
  requestGet,
  requestPost,
  throttle,
} from "../../utils";
import { useMessageContext, useRefreshBackgroundImage } from "../../hooks";
import ButtonSingleTap from "./ButtonSingleTap";
import { setIsLoading, setMaskArea } from "../../store/other";
import ButtonRepeatTap from "./ButtonRepeatTap";
import ButtonMultipleTap from "./ButtonMultipleTap";
import { clientPositionToMappingPosition } from "./tools";
import ButtonSwipe from "./ButtonSwipe";
import ButtonDirectionPad from "./ButtonDirectionPad";
import ButtonMouseCastSpell from "./ButtonMouseCastSpell";
import { CursorPos, DeviceBackground, RefreshImageButton } from "./Common";
import ButtonPadCastSpell from "./ButtonPadCastSpell";
import ButtonWheel from "./ButtonWheel";
import ButtonCancelCast from "./ButtonCancelCast";
import ButtonObservation from "./ButtonObservation";
import ButtonFps from "./ButtonFps";
import ButtonRawInput from "./ButtonRawInput";
import {
  setActiveMappingFile,
  setMappingRandomizationEnabled,
  setButtonRandomizationEnabled,
} from "../../store/localConfig";
import { useTranslation } from "react-i18next";
import { ItemBox, ItemBoxContainer } from "../common/ItemBox";
import ButtonFire from "./ButtonFire";
import ButtonScript from "./ButtonScript";
import MacroPresetModal, { isMacroScript, syncMacroScripts } from "./MacroPresetModal";
import { MappingOverlayProvider } from "./MappingOverlay";
import { EVENT_CODE_TO_KEY_CODE } from "./keyCode";
import { setReservedKeys } from "./reservedKeys";

type MappingQuickSwitch = {
  file: string;
  enabled: boolean;
  shortcut: string[];
};

type MappingFileTabelItem = {
  file: string;
  active: boolean;
  displayed: boolean;
  quickSwitch: MappingQuickSwitch;
};

type ScriptDiagnostic = {
  code: string;
  message: string;
  span: {
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
  };
  related?: {
    message: string;
    span: {
      startLine: number;
      startCol: number;
      endLine: number;
      endCol: number;
    };
  }[];
};

type MappingDiagnostic = {
  severity: "error";
  code: string;
  message: string;
  mappingType?: string;
  mappingIndex?: number;
  mappingId?: string;
  field?: string;
  scriptDiagnostic?: ScriptDiagnostic;
};

type MappingValidateResult = {
  valid: boolean;
  diagnostics: MappingDiagnostic[];
};

function isValidationError(error: unknown): error is ApiError<MappingValidateResult> {
  return (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    Array.isArray((error as ApiError<MappingValidateResult>).data?.diagnostics)
  );
}

function formatMappingDiagnostic(diagnostic: MappingDiagnostic) {
  const parts = [];
  if (diagnostic.mappingType && diagnostic.mappingIndex) {
    parts.push(`${diagnostic.mappingType}-${diagnostic.mappingIndex}`);
  }
  if (diagnostic.field) {
    parts.push(diagnostic.field);
  }
  const location = diagnostic.scriptDiagnostic
    ? `line ${diagnostic.scriptDiagnostic.span.startLine}, column ${diagnostic.scriptDiagnostic.span.startCol}`
    : "";
  const message = diagnostic.scriptDiagnostic?.message ?? diagnostic.message;
  const related = diagnostic.scriptDiagnostic?.related ?? [];
  const relatedText =
    related.length === 0
      ? ""
      : related
          .map(
            (item) =>
              `\n  ${item.message} (line ${item.span.startLine}, column ${item.span.startCol})`,
          )
          .join("");
  return `${parts.length ? `${parts.join(" / ")}: ` : ""}${location ? `${location}: ` : ""}${message}${relatedText}`;
}

type ConfirmProps = PropsWithChildren<{
  title: string;
  defaultValue: string;
  extral?: ReactNode;
  onConfirm: (value: string) => void;
}>;

function Confirm({
  title,
  defaultValue,
  extral,
  onConfirm,
  children,
}: ConfirmProps) {
  const { t } = useTranslation();
  defaultValue = defaultValue ?? "";
  const [newFile, setNewFile] = useState(defaultValue);

  return (
    <Popconfirm
      title={title}
      destroyOnHidden
      description={
        <ItemBoxContainer gap={8}>
          <ItemBox label={t("mappings.home.file")}>
            <Input
              placeholder={t("mappings.home.fileInputPlaceholder")}
              value={newFile}
              onChange={(e) => setNewFile(e.target.value)}
            />
          </ItemBox>
          {extral}
        </ItemBoxContainer>
      }
      onConfirm={() => onConfirm(newFile)}
      okText={t("mappings.home.confirmYes")}
      cancelText={t("mappings.home.confirmNo")}
    >
      {children}
    </Popconfirm>
  );
}

function Manager({
  open,
  onCancel,
  mappingList,
  displayedMapping,
  onActiveAction,
  onDisplayAction,
  onDuplicateAction,
  onDeleteAction,
  onCreateAction,
  onRenameAction,
  onMigrateAction,
  quickSwitches,
  onQuickSwitchChange,
}: {
  open: boolean;
  onCancel: () => void;
  mappingList: string[];
  displayedMapping: string;
  onActiveAction: (file: string) => void;
  onDisplayAction: (file: string) => void;
  onDuplicateAction: (file: string, newFile: string) => void;
  onDeleteAction: (file: string) => void;
  onCreateAction: (
    file: string,
    size: { width: number; height: number },
  ) => void;
  onRenameAction: (file: string, newFile: string) => void;
  onMigrateAction: (
    file: string,
    newFile: string,
    size: { width: number; height: number },
  ) => void;
  quickSwitches: MappingQuickSwitch[];
  onQuickSwitchChange: (
    file: string,
    quickSwitch: Omit<MappingQuickSwitch, "file">,
  ) => void;
}) {
  const { t } = useTranslation();
  const messageApi = useMessageContext();
  const activeMappingFile = useAppSelector(
    (state) => state.localConfig.activeMappingFile,
  );
  const controlledDevices = useAppSelector(
    (state) => state.other.controlledDevices,
  );

  const [newSize, setNewSize] = useState<{ width: number; height: number }>({
    width: 1280,
    height: 720,
  });

  const mappingFiles = useMemo<MappingFileTabelItem[]>(() => {
    return mappingList.map((file) => {
      return {
        file,
        active: file === activeMappingFile,
        displayed: file === displayedMapping,
        quickSwitch: quickSwitches.find((config) => config.file === file) ?? {
          file,
          enabled: false,
          shortcut: [],
        },
      };
    });
  }, [mappingList, activeMappingFile, displayedMapping, quickSwitches]);

  const columns: TableProps<MappingFileTabelItem>["columns"] = [
    {
      title: (
        <Space size="large">
          {t("mappings.home.file")}
          <Confirm
            title={t("mappings.home.createTitle")}
            onConfirm={(newFile) => onCreateAction(newFile, newSize)}
            defaultValue=""
            extral={
              <ItemBox label={t("mappings.home.size")}>
                <Space.Compact className="w-full">
                  <InputNumber
                    className="w-full"
                    prefix="W:"
                    value={newSize.width}
                    min={1}
                    onChange={(v) =>
                      v !== null && setNewSize({ ...newSize, width: v })
                    }
                  />
                  <InputNumber
                    className="w-full"
                    prefix="H:"
                    value={newSize.height}
                    min={1}
                    onChange={(v) =>
                      v !== null && setNewSize({ ...newSize, height: v })
                    }
                  />
                </Space.Compact>
              </ItemBox>
            }
          >
            <IconButton
              color="info"
              tooltip={t("mappings.home.create")}
              icon={<FileAddOutlined />}
              onClick={() => {
                const mainDevice = controlledDevices.find((d) => d.main);
                if (mainDevice) {
                  setNewSize({
                    width: mainDevice.device_size[0],
                    height: mainDevice.device_size[1],
                  });
                }
              }}
            />
          </Confirm>
        </Space>
      ),
      dataIndex: "file",
      key: "file",
      render: (_, record) => (
        <Flex align="center" justify="space-between" className="p-r-3">
          <span>{record.file}</span>
          <Space size={32}>
            {record.displayed && (
              <Badge status="processing" text={t("mappings.home.editing")} />
            )}
            {record.active && (
              <Badge status="success" text={t("mappings.home.active")} />
            )}
          </Space>
        </Flex>
      ),
    },
    {
      title: t("mappings.home.quickSwitch"),
      key: "quickSwitch",
      width: 370,
      render: (_, record) => (
        <Flex align="center" gap="small" wrap={false}>
          <Switch
            checked={record.quickSwitch.enabled}
            onChange={(enabled) => {
              if (enabled && record.quickSwitch.shortcut.length === 0) {
                messageApi?.warning(t("mappings.home.quickSwitchNeedShortcut"));
                return;
              }
              onQuickSwitchChange(record.file, {
                enabled,
                shortcut: record.quickSwitch.shortcut,
              });
            }}
          />
          <Tooltip title={t("mappings.home.quickSwitchHint")}>
            <Input
              readOnly
              value={record.quickSwitch.shortcut.join(" + ")}
              placeholder={t("mappings.home.quickSwitchPlaceholder")}
              onKeyDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (event.code === "Backspace" || event.code === "Delete") {
                  onQuickSwitchChange(record.file, {
                    enabled: false,
                    shortcut: [],
                  });
                  return;
                }
                if (
                  ["ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight"].includes(event.code)
                ) {
                  return;
                }
                const key = EVENT_CODE_TO_KEY_CODE[event.code as keyof typeof EVENT_CODE_TO_KEY_CODE];
                if (!key) return;
                const shortcut: string[] = [];
                if (event.ctrlKey) shortcut.push("ControlLeft");
                if (event.altKey) shortcut.push("AltLeft");
                if (event.shiftKey) shortcut.push("ShiftLeft");
                if (event.metaKey) shortcut.push("SuperLeft");
                shortcut.push(key);
                onQuickSwitchChange(record.file, {
                  enabled: true,
                  shortcut,
                });
              }}
            />
          </Tooltip>
          <Button
            type="text"
            danger
            aria-label={t("mappings.home.clearQuickSwitch")}
            icon={<CloseCircleOutlined />}
            onClick={() =>
              onQuickSwitchChange(record.file, {
                enabled: false,
                shortcut: [],
              })
            }
          />
        </Flex>
      ),
    },
    {
      title: t("mappings.home.action"),
      key: "action",
      align: "center",
      width: 1,
      render: (_, record) => (
        <Space size="middle" className="text-4">
          <IconButton
            color="info"
            icon={<FileTextOutlined />}
            tooltip={t("mappings.home.edit")}
            onClick={() => onDisplayAction(record.file)}
          />
          <IconButton
            color="success"
            tooltip={t("mappings.home.activate")}
            icon={<CheckCircleOutlined />}
            onClick={() => onActiveAction(record.file)}
          />
          <Confirm
            title={t("mappings.home.renameTitle")}
            onConfirm={(newFile) => {
              if (newFile === record.file) {
                messageApi?.warning(t("mappings.home.differentName"));
              } else {
                onRenameAction(record.file, newFile);
              }
            }}
            defaultValue={record.file}
          >
            <IconButton
              color="warning"
              icon={<EditOutlined />}
              tooltip={t("mappings.home.rename")}
            />
          </Confirm>
          <Popconfirm
            title={t("mappings.home.deleteTitle")}
            destroyOnHidden
            description={t("mappings.home.deletePrompt")}
            onConfirm={() => onDeleteAction(record.file)}
            okText={t("mappings.home.confirmYes")}
            cancelText={t("mappings.home.confirmNo")}
          >
            <IconButton
              color="error"
              tooltip={t("mappings.home.delete")}
              icon={<DeleteOutlined />}
            />
          </Popconfirm>
          <Confirm
            title={t("mappings.home.duplicateTitle")}
            onConfirm={(newFile) => {
              if (newFile === record.file) {
                messageApi?.warning(t("mappings.home.differentName"));
              } else {
                onDuplicateAction(record.file, newFile);
              }
            }}
            defaultValue={record.file}
          >
            <IconButton
              color="info"
              tooltip={t("mappings.home.duplicate")}
              icon={<CopyOutlined />}
            />
          </Confirm>
          <Confirm
            title={t("mappings.home.migrationTitle")}
            onConfirm={(newFile) => {
              if (newFile === record.file) {
                messageApi?.warning(t("mappings.home.differentName"));
              } else {
                onMigrateAction(record.file, newFile, newSize);
              }
            }}
            defaultValue={record.file}
            extral={
              <ItemBox label={t("mappings.home.size")}>
                <Space.Compact className="w-full">
                  <InputNumber
                    className="w-full"
                    prefix="W:"
                    value={newSize.width}
                    min={1}
                    onChange={(v) =>
                      v !== null && setNewSize({ ...newSize, width: v })
                    }
                  />
                  <InputNumber
                    className="w-full"
                    prefix="H:"
                    value={newSize.height}
                    min={1}
                    onChange={(v) =>
                      v !== null && setNewSize({ ...newSize, height: v })
                    }
                  />
                </Space.Compact>
              </ItemBox>
            }
          >
            <IconButton
              color="warning"
              tooltip={t("mappings.home.migration")}
              icon={<SnippetsOutlined />}
              onClick={() => {
                const mainDevice = controlledDevices.find((d) => d.main);
                if (mainDevice) {
                  setNewSize({
                    width: mainDevice.device_size[0],
                    height: mainDevice.device_size[1],
                  });
                } else {
                  messageApi?.warning(t("mappings.common.noMainDevice"));
                }
              }}
            />
          </Confirm>
        </Space>
      ),
    },
  ];

  return (
    <Modal
      title={t("mappings.home.manager")}
      className="min-w-50vw"
      open={open}
      onCancel={onCancel}
      footer={null}
    >
      <Table<MappingFileTabelItem>
        size="small"
        rowKey={(record) => record.file}
        pagination={{ pageSize: 7 }}
        columns={columns}
        dataSource={mappingFiles}
      />
    </Modal>
  );
}

type EditState = {
  file: string;
  edited: boolean;
  current: MappingConfig;
  old: MappingConfig;
};

const buttonTypes = [
  "SingleTap",
  "LongPress",
  "RepeatTap",
  "MultipleTap",
  "Swipe",
  "DirectionPad",
  "MouseCastSpell",
  "PadCastSpell",
  "CancelCast",
  "Observation",
  "Fps",
  "Fire",
  "RawInput",
  "Script",
  "Wheel",
];

const mappingButtonMap = {
  SingleTap: ButtonSingleTap,
  RepeatTap: ButtonRepeatTap,
  MultipleTap: ButtonMultipleTap,
  Swipe: ButtonSwipe,
  DirectionPad: ButtonDirectionPad,
  MouseCastSpell: ButtonMouseCastSpell,
  PadCastSpell: ButtonPadCastSpell,
  CancelCast: ButtonCancelCast,
  Observation: ButtonObservation,
  Fps: ButtonFps,
  Fire: ButtonFire,
  RawInput: ButtonRawInput,
  Script: ButtonScript,
  Wheel: ButtonWheel,
};

const mappingConstructorMap: any = Object.fromEntries(
  buttonTypes.map((key) => [
    key,
    MappingConstructor[`new${key}` as keyof typeof MappingConstructor],
  ]),
);

// Order matters: derived variants are grouped right after their base type so
// related controls (e.g. direction pad, its toggle-run variant, and the wheel)
// stay together in the "add mapping" menu.
const menuItems: [string, string][] = [
  ["SingleTap", "mappings.singleTap.name"],
  ["LongPress", "mappings.longPress.name"],
  ["StealthTap", "mappings.stealthTap.name"],
  ["RepeatTap", "mappings.repeatTap.name"],
  ["MultipleTap", "mappings.multipleTap.name"],
  ["Swipe", "mappings.swipe.name"],
  ["DirectionPad", "mappings.directionPad.name"],
  ["DirectionPadToggleRun", "mappings.directionPadToggleRun.name"],
  ["Wheel", "mappings.wheel.name"],
  ["MouseCastSpell", "mappings.mouseCastSpell.name"],
  ["PadCastSpell", "mappings.padCastSpell.name"],
  ["CancelCast", "mappings.cancelCast.name"],
  ["Observation", "mappings.observation.name"],
  ["Fps", "mappings.fps.name"],
  ["Fire", "mappings.fire.name"],
  ["RawInput", "mappings.rawInput.name"],
  ["Script", "mappings.script.name"],
];

const firstAutoPointerId = 1;

function getNextAvailablePointerId(mappings: MappingType[]): number {
  return getNextAvailablePointerIdWithReserved(mappings, []);
}

function mappingPointerIds(mapping: MappingType): number[] {
  const pointerIds: number[] = [];
  if (
    "pointer_id" in mapping &&
    Number.isInteger(mapping.pointer_id) &&
    mapping.pointer_id >= firstAutoPointerId
  ) {
    pointerIds.push(mapping.pointer_id);
  }
  if (mapping.type !== "Fps" || mapping.touch_mode.type !== "dual") {
    return pointerIds;
  }
  if (
    Number.isInteger(mapping.touch_mode.another_pointer_id) &&
    mapping.touch_mode.another_pointer_id >= firstAutoPointerId
  ) {
    pointerIds.push(mapping.touch_mode.another_pointer_id);
  }
  return pointerIds;
}

function getNextAvailablePointerIdWithReserved(
  mappings: MappingType[],
  reserved: number[],
): number {
  const usedPointerIds = new Set<number>(reserved);
  for (const mapping of mappings) {
    for (const pointerId of mappingPointerIds(mapping)) {
      usedPointerIds.add(pointerId);
    }
  }

  let pointerId = firstAutoPointerId;
  while (usedPointerIds.has(pointerId)) {
    pointerId += 1;
  }
  return pointerId;
}

function assignNextAvailablePointerId(
  mapping: MappingType,
  mappings: MappingType[],
) {
  if ("pointer_id" in mapping) {
    mapping.pointer_id = getNextAvailablePointerId(mappings);
  }
  if (mapping.type !== "Fps" || mapping.touch_mode.type !== "dual") {
    return;
  }
  mapping.touch_mode.another_pointer_id = getNextAvailablePointerIdWithReserved(
    mappings,
    [mapping.pointer_id],
  );
}

function Displayer({
  state,
  setState,
  showAllMappingGuides,
  showRandomRanges,
}: {
  state: EditState;
  setState: React.Dispatch<React.SetStateAction<EditState | null>>;
  showAllMappingGuides: boolean;
  showRandomRanges: boolean;
}) {
  const dispatch = useAppDispatch();
  const maskArea = useAppSelector((state) => state.other.maskArea);
  const { t } = useTranslation();

  const cursorPosRef = useRef<HTMLDivElement>(null);
  const displayerRef = useRef<HTMLDivElement>(null);
  const contextMenuPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [overlayViewportOrigin, setOverlayViewportOrigin] = useState<{
    left: number;
    top: number;
  } | null>(null);
  // 旋转预览：true 时交换宽高（横屏↔竖屏），键位坐标跟随旋转，仅影响编辑显示
  const [rotated, setRotated] = useState(false);
  // 隐藏映射按键图标：隐藏画布上的按键图标，便于查看背景
  const [hideIcons, setHideIcons] = useState(false);
  // 自定义模板分辨率弹窗
  const [sizeEditOpen, setSizeEditOpen] = useState(false);
  const [sizeW, setSizeW] = useState(0);
  const [sizeH, setSizeH] = useState(0);

  const getMappingContainerScroll = useCallback(() => {
    const mappingContainer = document.getElementById("mappings-container");
    return {
      left: mappingContainer?.scrollLeft ?? 0,
      top: mappingContainer?.scrollTop ?? 0,
    };
  }, []);

  const updateOverlayViewportOrigin = useCallback(() => {
    const displayerElement = displayerRef.current;
    if (!displayerElement) return;

    const rect = displayerElement.getBoundingClientRect();
    setOverlayViewportOrigin({
      left: rect.left + 1,
      top: rect.top + 1,
    });
  }, []);

  const updateMaskArea = useCallback(() => {
    const displayerElement = displayerRef.current;
    if (!displayerElement) return;

    const rect = displayerElement.getBoundingClientRect();
    const scroll = getMappingContainerScroll();
    dispatch(
      setMaskArea({
        width: rect.width - 2,
        height: rect.height - 2,
        left: rect.left + scroll.left + 1,
        top: rect.top + scroll.top + 1,
      }),
    );
    updateOverlayViewportOrigin();
  }, [dispatch, getMappingContainerScroll, updateOverlayViewportOrigin]);

  useEffect(() => {
    const displayerElement = displayerRef.current;
    if (!displayerElement) return;

    const observer = new ResizeObserver(updateMaskArea);
    observer.observe(displayerElement);
    updateMaskArea();

    return () => {
      observer.disconnect();
    };
  }, [updateMaskArea]);

  useEffect(() => {
    const mappingContainer = document.getElementById("mappings-container");
    mappingContainer?.addEventListener("scroll", updateOverlayViewportOrigin);
    window.addEventListener("resize", updateMaskArea);

    return () => {
      mappingContainer?.removeEventListener(
        "scroll",
        updateOverlayViewportOrigin,
      );
      window.removeEventListener("resize", updateMaskArea);
    };
  }, [updateMaskArea, updateOverlayViewportOrigin]);

  const { ratioStyle, originalSize, displayMappings } = useMemo(() => {
    // 使用映射模板自己的分辨率（original_size），每个模板可自定义
    const width = state.current.original_size.width;
    const height = state.current.original_size.height;

    // 旋转预览：交换宽高，键位坐标跟随顺时针旋转
    if (rotated) {
      const displayMappings = state.current.mappings.map((m) =>
        rotateMapping(m, height),
      );
      return {
        originalSize: { width: height, height: width },
        ratioStyle: {
          width: "100%",
          aspectRatio: `${height} / ${width}`,
        },
        displayMappings,
      };
    }
    return {
      originalSize: { width, height },
      ratioStyle: {
        width: "100%",
        aspectRatio: `${width} / ${height}`,
      },
      displayMappings: state.current.mappings,
    };
  }, [
    state.current.original_size.width,
    state.current.original_size.height,
    rotated,
    state.current.mappings,
  ]);

  function updateMapping(
    index: number,
    updater: MappingType | ((prev: any) => any),
  ) {
    setState((prev) => {
      if (prev === null) return null;
      const newState = { ...prev };
      newState.edited = true;
      newState.current.mappings[index] =
        typeof updater === "function"
          ? updater(newState.current.mappings[index])
          : updater;

      return newState;
    });
  }

  function deleteMappingButton(index: number) {
    setState((prev) => {
      if (prev === null) return null;
      const newState = { ...prev };
      newState.edited = true;
      newState.current.mappings.splice(index, 1);

      return newState;
    });
  }

  function copyMappingButton(index: number) {
    setState((prev) => {
      if (prev === null) return null;
      const newState = { ...prev };
      newState.edited = true;
      const mapping = {
        ...deepClone(newState.current.mappings[index]),
        id: newMappingId(),
      };
      assignNextAvailablePointerId(mapping, newState.current.mappings);
      newState.current.mappings.push(mapping);

      return newState;
    });
  }

  const handleMouseMove = throttle((e: React.MouseEvent) => {
    if (cursorPosRef.current) {
      const { x, y } = clientPositionToMappingPosition(
        e.clientX,
        e.clientY,
        maskArea,
        state.current.original_size.width,
        state.current.original_size.height,
      );
      cursorPosRef.current.innerText = `(${x},${y})`;
    }
  }, 100);

  return (
    <div className="mapping-editor w-full">
      <Flex justify="space-between" align="center" gap={8} wrap>
        <Flex gap={8} align="center" wrap>
          <CursorPos ref={cursorPosRef} />
          <Button
            size="small"
            type={rotated ? "primary" : "default"}
            icon={<SwapOutlined />}
            onClick={() => setRotated((v) => !v)}
          >
            {t("mappings.home.rotatePreview")}
          </Button>
          <Button
            size="small"
            type={hideIcons ? "primary" : "default"}
            icon={hideIcons ? <EyeInvisibleOutlined /> : <EyeOutlined />}
            onClick={() => setHideIcons((v) => !v)}
          >
            {t("mappings.home.hideIcons")}
          </Button>
        </Flex>
        <Button
          type="text"
          size="small"
          className="color-text-secondary font-bold"
          onClick={() => {
            setSizeW(state.current.original_size.width);
            setSizeH(state.current.original_size.height);
            setSizeEditOpen(true);
          }}
        >
          {`[${originalSize.width} x ${originalSize.height}]`}
        </Button>
      </Flex>
      <div
        ref={displayerRef}
        className={`w-full border-text-quaternary border-solid border relative select-none ${
          hideIcons ? "mapping-icons-hidden" : ""
        }`}
        style={ratioStyle}
        onMouseMove={handleMouseMove}
      >
        <DeviceBackground />
        <Dropdown
          menu={{
            items: menuItems.map(([key, tID]) => ({
              key,
              label: t(tID),
            })),
            onClick({ key }) {
              let config: MappingType;
              if (key === "DirectionPadToggleRun") {
                config = MappingConstructor.newDirectionPadToggleRun(
                  contextMenuPosRef.current,
                );
              } else if (key === "StealthTap") {
                config = MappingConstructor.newStealthTap(
                  contextMenuPosRef.current,
                );
              } else if (key === "MouseCastSpell") {
                config = mappingConstructorMap.MouseCastSpell(
                  contextMenuPosRef.current,
                  {
                    x: originalSize.width / 2,
                    y: Math.round(originalSize.height * 0.566),
                  },
                );
              } else {
                config = mappingConstructorMap[key](contextMenuPosRef.current);
              }
              const newState = { ...state, edited: true };
              assignNextAvailablePointerId(config, newState.current.mappings);
              newState.current.mappings.push(config);
              setState(newState);
            },
          }}
          trigger={["contextMenu"]}
        >
          <div
            onContextMenu={(e) => {
              contextMenuPosRef.current = clientPositionToMappingPosition(
                e.clientX,
                e.clientY,
                maskArea,
                originalSize.width,
                originalSize.height,
              );
            }}
            className="w-full h-full absolute bg-transparent"
          />
        </Dropdown>
        <MappingOverlayProvider
          showAllGuides={showAllMappingGuides}
          showRandomRanges={showRandomRanges}
          viewportOrigin={overlayViewportOrigin}
          viewportSize={{ width: maskArea.width, height: maskArea.height }}
        >
          {displayMappings.map((mapping, index) => {
            const props: any = {
              originalSize,
              index,
              config: mapping,
              onConfigChange: (updater: any | ((prev: any) => any)) =>
                updateMapping(index, updater),
              onConfigDelete: () => deleteMappingButton(index),
              onConfigCopy: () => copyMappingButton(index),
              getAvailablePointerId: (reserved: number[] = []) =>
                getNextAvailablePointerIdWithReserved(
                  state.current.mappings,
                  reserved,
                ),
            };

            // Macro presets reuse the Script backend but are maintained from the top macro manager.
            // Do not render them as normal circular mapping buttons on the canvas.
            if (isMacroScript(mapping)) return null;
            if (mapping.type in mappingButtonMap) {
              const ButtonComponent =
                mappingButtonMap[mapping.type as keyof typeof mappingButtonMap];
              return <ButtonComponent key={index} {...props} />;
            }

            return <div key={index}></div>;
          })}
        </MappingOverlayProvider>
      </div>
      <Modal
        open={sizeEditOpen}
        title={t("mappings.home.customResolution")}
        okText={t("mappings.home.applyResolution")}
        cancelText={t("mappings.common.cancel")}
        onCancel={() => setSizeEditOpen(false)}
        onOk={() => {
          if (sizeW > 0 && sizeH > 0) {
            setState((prev) =>
              prev
                ? {
                    ...prev,
                    edited: true,
                    current: {
                      ...prev.current,
                      original_size: { width: sizeW, height: sizeH },
                    },
                  }
                : prev,
            );
          }
          setSizeEditOpen(false);
        }}
      >
        {/* 显著提示：分辨率必须与手机一致，不一致会错位 */}
        <Alert
          type="warning"
          showIcon
          message={t("mappings.home.resolutionMustMatch")}
          style={{ marginBottom: 12 }}
        />
        <Alert
          type="error"
          showIcon
          message={t("mappings.home.resolutionMismatchWarning")}
          description={t("mappings.home.resolutionMismatchDetail")}
          style={{ marginBottom: 12 }}
        />
        <Flex align="center" gap={8}>
          <InputNumber
            min={1}
            value={sizeW}
            onChange={(v) => setSizeW(v ?? 0)}
            placeholder="W"
            style={{ width: 120 }}
          />
          <span>x</span>
          <InputNumber
            min={1}
            value={sizeH}
            onChange={(v) => setSizeH(v ?? 0)}
            placeholder="H"
            style={{ width: 120 }}
          />
        </Flex>
      </Modal>
    </div>
  );
}

// 按钮 DOM id 前缀映射（与各 Button 组件内部 id 命名保持一致）
function mappingButtonDomPrefix(type: string): string {
  switch (type) {
    case "RepeatTap":
      return "mapping-repeat-tap";
    case "MultipleTap":
      return "mapping-multiple-tap";
    case "DirectionPad":
    case "PadCastSpell":
      return "mapping-direction-pad";
    case "MouseCastSpell":
      return "mapping-mouse-cast-spell";
    case "Fps":
      return "mapping-fps";
    case "Wheel":
      return "mapping-wheel";
    default:
      // SingleTap / Observation / Script / RawInput / Fire / CancelCast / Swipe
      return "mapping-single-tap";
  }
}

function pushKeys(
  target: { key: string; type: string; index: number; label: string }[],
  binds: string[] | undefined,
  type: string,
  index: number,
  label: string,
) {
  if (Array.isArray(binds)) {
    binds.forEach((k) => target.push({ key: k, type, index, label }));
  }
}

// 提取单个映射的所有绑定条目（含方向按键、副键、取消键等）
function collectMappingBindings(mapping: MappingType, index: number) {
  const results: { key: string; type: string; index: number; label: string }[] = [];
  const m = mapping as any;
  const label = (m.note && m.note.trim() ? m.note : (mapping.type as string));
  pushKeys(results, m.bind, mapping.type, index, label);
  if (m.bind && typeof m.bind === "object" && m.bind.type === "Button") {
    pushKeys(results, m.bind.up, mapping.type, index, `${label}·上`);
    pushKeys(results, m.bind.down, mapping.type, index, `${label}·下`);
    pushKeys(results, m.bind.left, mapping.type, index, `${label}·左`);
    pushKeys(results, m.bind.right, mapping.type, index, `${label}·右`);
  }
  if (m.pad_bind && typeof m.pad_bind === "object" && m.pad_bind.type === "Button") {
    pushKeys(results, m.pad_bind.up, mapping.type, index, `${label}·上`);
    pushKeys(results, m.pad_bind.down, mapping.type, index, `${label}·下`);
    pushKeys(results, m.pad_bind.left, mapping.type, index, `${label}·左`);
    pushKeys(results, m.pad_bind.right, mapping.type, index, `${label}·右`);
  }
  pushKeys(results, m.cancel_bind, mapping.type, index, `${label}·取消`);
  if (Array.isArray(m.up_boost_key)) {
    pushKeys(results, m.up_boost_key, mapping.type, index, `${label}·加速`);
  }
  return results;
}

// 顺时针旋转 90°：原 (x, y) → (oH - y, x)
function rotatePoint(x: number, y: number, oH: number) {
  return { x: Math.round(oH - y), y: Math.round(x) };
}

// 深拷贝并旋转一个映射项的所有位置坐标（position / positions / items）
function rotateMapping(mapping: MappingType, oH: number): MappingType {
  const m: any = deepClone(mapping);
  const rot = (p: any) =>
    p && typeof p.x === "number" && typeof p.y === "number"
      ? rotatePoint(p.x, p.y, oH)
      : p;
  if (m.position) m.position = rot(m.position);
  if (Array.isArray(m.positions)) m.positions = m.positions.map(rot);
  if (Array.isArray(m.items)) {
    m.items = m.items.map((it: any) => ({ ...it, position: rot(it.position) }));
  }
  // MouseCastSpell / PadCastSpell 可能用 cast_points / positions 存多个点
  if (Array.isArray(m.cast_points)) m.cast_points = m.cast_points.map(rot);
  return m;
}

// 按键定位列表：列出所有绑定按键，点击后在画布上高亮对应按钮
function KeyBindingList({
  mappings,
  onSelect,
}: {
  mappings: MappingType[];
  onSelect: (elementId: string) => void;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const entries = useMemo(() => {
    const all: { key: string; type: string; index: number; label: string; elementId: string }[] = [];
    mappings.forEach((mapping, index) => {
      if (isMacroScript(mapping)) return;
      collectMappingBindings(mapping, index).forEach((e) => {
        all.push({ ...e, elementId: `${mappingButtonDomPrefix(e.type)}-${e.index}` });
      });
    });
    // 按按键名分组，相同按键聚合显示
    const groups = new Map<string, typeof all>();
    all.forEach((e) => {
      if (!groups.has(e.key)) groups.set(e.key, []);
      groups.get(e.key)!.push(e);
    });
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [mappings]);

  if (entries.length === 0) {
    return (
      <div className="p-3 color-text-secondary text-sm">
        {t("mappings.home.noBoundKeys")}
      </div>
    );
  }

  // 每页 10 个按键分组
  const start = (page - 1) * pageSize;
  const pagedEntries = entries.slice(start, start + pageSize);

  return (
    <div className="p-3 flex flex-col gap-2">
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        {t("mappings.home.boundKeysTitle")}
      </Typography.Title>
      <div className="flex flex-col gap-2 flex-grow-1">
        {pagedEntries.map(([key, list]) => (
          <div key={key} className="border border-text-quaternary rounded p-2">
            <Tag color="blue">{list.length > 1 ? `${key} ×${list.length}` : key}</Tag>
            <div className="flex flex-col gap-1 mt-1">
              {list.map((e, i) => (
                <button
                  key={`${e.index}-${i}`}
                  type="button"
                  className="text-left text-sm px-2 py-1 rounded hover:bg-white/10 cursor-pointer color-text"
                  onClick={() => onSelect(e.elementId)}
                >
                  <span className="color-text-secondary mr-1">
                    {t(`mappings.${e.type.charAt(0).toLowerCase() + e.type.slice(1)}.name`)}
                  </span>
                  #{e.index}
                  {e.label && <span className="ml-1 color-text-secondary">· {e.label}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Pagination
        size="small"
        current={page}
        pageSize={pageSize}
        total={entries.length}
        showSizeChanger={false}
        onChange={setPage}
        style={{ marginTop: 8 }}
      />
    </div>
  );
}

// 点击按键列表项：高亮画布上对应的按钮并滚动到可见位置
function highlightMappingButton(elementId: string) {
  document
    .querySelectorAll(".mapping-highlight")
    .forEach((el) => el.classList.remove("mapping-highlight"));
  const el = document.getElementById(elementId);
  if (!el) return;
  el.classList.add("mapping-highlight");
  const container = document.getElementById("mappings-container");
  if (container) {
    const rect = el.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    container.scrollBy({
      left: rect.left - containerRect.left - container.clientWidth / 2,
      top: rect.top - containerRect.top - container.clientHeight / 2,
      behavior: "smooth",
    });
  }
}

export default function Mappings() {
  const messageApi = useMessageContext();
  const activeMappingFile = useAppSelector(
    (state) => state.localConfig.activeMappingFile,
  );
  const refreshBackground = useRefreshBackgroundImage();
  const dispatch = useAppDispatch();
  const { t } = useTranslation();

  const [displayedMappingFile, setDisplayedMappingFile] = useState("");
  const [isManagerOpen, setIsManagerOpen] = useState(false);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [mappingList, setMappingList] = useState<string[]>([]);
  const [mappingQuickSwitches, setMappingQuickSwitches] = useState<MappingQuickSwitch[]>([]);
  const [quickSwitchEnabled, setQuickSwitchEnabled] = useState(true);
  const [macroPresetEnabled, setMacroPresetEnabled] = useState(true);
  const randomizationEnabled = useAppSelector(
    (state) => state.localConfig.mappingRandomizationEnabled,
  );
  const buttonRandomizationEnabled = useAppSelector(
    (state) => state.localConfig.buttonRandomizationEnabled,
  );
  const [showAllMappingGuides, setShowAllMappingGuides] = useState(false);
  const [showRandomRanges, setShowRandomRanges] = useState(false);
  const [positionUnlocked, setPositionUnlocked] = useState(false);
  const [isMacroManagerOpen, setIsMacroManagerOpen] = useState(false);
  const [isBoundSettingsOpen, setIsBoundSettingsOpen] = useState(false);
  const [validationDiagnostics, setValidationDiagnostics] = useState<
    MappingDiagnostic[]
  >([]);

  const mappingListOptions = useMemo(() => {
    return mappingList.map((item) => ({
      label: (
        <Flex justify="space-between" align="center">
          <span>{item}</span>
          {activeMappingFile === item && (
            <Badge color="green" text={t("mappings.home.active")} />
          )}
        </Flex>
      ),
      value: item,
    }));
  }, [mappingList, activeMappingFile]);

  useEffect(() => {
    loadMappingList();
    refreshBackground(true);
  }, []);

  useEffect(() => {
    if (displayedMappingFile === "" && activeMappingFile !== "") {
      changeDisplayedMapping(activeMappingFile);
    }
  }, [activeMappingFile]);

  // 收集被占用按键：预设切换快捷键 + 宏预设绑定的按键。
  // 关闭对应全局开关时不再占用，允许下方按键使用。
  useEffect(() => {
    const reserved = new Set<string>();
    if (quickSwitchEnabled) {
      mappingQuickSwitches.forEach((qs) => {
        qs.shortcut.forEach((k) => reserved.add(k));
      });
    }
    if (macroPresetEnabled) {
      (editState?.current.mappings ?? [])
        .filter(isMacroScript)
        .forEach((m) => {
          m.bind.forEach((k) => reserved.add(k));
        });
    }
    setReservedKeys(reserved);
  }, [mappingQuickSwitches, editState, quickSwitchEnabled, macroPresetEnabled]);

  async function loadMappingList(silent: boolean = false) {
    if (!silent) dispatch(setIsLoading(true));
    try {
      const res = await requestGet<{
        mapping_list: string[];
        active_mapping: string;
        mapping_quick_switches: MappingQuickSwitch[];
        quick_switch_enabled: boolean;
        macro_preset_enabled: boolean;
        mapping_randomization_enabled: boolean;
        button_randomization_enabled: boolean;
      }>("/api/mapping/get_mapping_list");
      setMappingList(res.data.mapping_list);
      setMappingQuickSwitches(res.data.mapping_quick_switches ?? []);
      setQuickSwitchEnabled(res.data.quick_switch_enabled ?? true);
      setMacroPresetEnabled(res.data.macro_preset_enabled ?? true);
      dispatch(setMappingRandomizationEnabled(res.data.mapping_randomization_enabled ?? true));
      dispatch(setButtonRandomizationEnabled(res.data.button_randomization_enabled ?? true));
      if (activeMappingFile !== res.data.active_mapping)
        dispatch(setActiveMappingFile(res.data.active_mapping));

      // current displayed file is not in the list
      if (
        res.data.mapping_list.findIndex(
          (file) => file === displayedMappingFile,
        ) == -1
      ) {
        setDisplayedMappingFile(res.data.active_mapping);
      }
    } catch (error: any) {
      if (!silent) messageApi?.error(error);
    }
    if (!silent) dispatch(setIsLoading(false));
  }

  async function updateGlobalToggle(key: string, value: boolean) {
    try {
      await requestPost<{ config: any }>("/api/config/update_config", {
        key,
        value,
      });
      if (key === "quick_switch_enabled") setQuickSwitchEnabled(value);
      if (key === "macro_preset_enabled") setMacroPresetEnabled(value);
      if (key === "mapping_randomization_enabled")
        dispatch(setMappingRandomizationEnabled(value));
      if (key === "button_randomization_enabled")
        dispatch(setButtonRandomizationEnabled(value));
      messageApi?.success(
        t(
          key === "quick_switch_enabled"
            ? "mappings.home.quickSwitchUpdated"
            : key === "macro_preset_enabled"
              ? "mappings.home.macroPresetUpdated"
              : key === "button_randomization_enabled"
                ? "mappings.home.buttonRandomizationUpdated"
                : "mappings.home.randomizationUpdated",
        ),
      );
    } catch (error: any) {
      messageApi?.error(error);
    }
  }

  async function changeDisplayedMapping(file: string) {
    if (!file) return;
    dispatch(setIsLoading(true));
    try {
      const res = await requestPost<{ mapping_config: MappingConfig }>(
        "/api/mapping/read_mapping",
        {
          file,
        },
      );
      const mappingConfig = normalizeMappingConfig(res.data.mapping_config);
      setDisplayedMappingFile(file);
      setEditState({
        file,
        edited: false,
        current: mappingConfig,
        old: deepClone(mappingConfig),
      });
    } catch (error: any) {
      if (isValidationError(error)) {
        setValidationDiagnostics(error.data?.diagnostics ?? []);
      } else {
        messageApi?.error(error);
      }
    }
    dispatch(setIsLoading(false));
  }

  async function changeActiveMapping(file: string) {
    if (!macroPresetEnabled) {
      // 宏预设关闭：直接切换，不合并宏预设，也不受切换影响
      dispatch(setIsLoading(true));
      try {
        const res = await requestPost("/api/mapping/change_active_mapping", {
          file,
        });
        dispatch(setActiveMappingFile(file));
        messageApi?.success(res.message);
      } catch (error: any) {
        messageApi?.error(error);
      }
      dispatch(setIsLoading(false));
      return;
    }
    dispatch(setIsLoading(true));
    try {
      // 保留当前已激活配置中的宏预设，合并到目标预设中，使宏预设不随预设切换而丢失
      const currentRes = await requestPost<{ mapping_config: MappingConfig }>(
        "/api/mapping/read_mapping",
        { file: activeMappingFile },
      );
      const currentConfig = normalizeMappingConfig(
        currentRes.data.mapping_config,
      );
      const currentMacros = currentConfig.mappings.filter(isMacroScript);

      if (currentMacros.length > 0 && file !== activeMappingFile) {
        const targetRes = await requestPost<{ mapping_config: MappingConfig }>(
          "/api/mapping/read_mapping",
          { file },
        );
        const targetConfig = normalizeMappingConfig(
          targetRes.data.mapping_config,
        );
        const targetMacroIds = new Set(
          targetConfig.mappings.filter(isMacroScript).map((m) => m.id),
        );
        const mergedMacros = currentMacros.filter(
          (m) => !targetMacroIds.has(m.id),
        );
        if (mergedMacros.length > 0) {
          const merged = syncMacroScripts({
            ...targetConfig,
            mappings: [...targetConfig.mappings, ...mergedMacros],
          });
          await requestPost("/api/mapping/update_mapping", {
            file,
            config: merged,
          });
        }
      }

      const res = await requestPost("/api/mapping/change_active_mapping", {
        file,
      });
      dispatch(setActiveMappingFile(file));
      messageApi?.success(res.message);
    } catch (error: any) {
      messageApi?.error(error);
    }
    dispatch(setIsLoading(false));
  }

  async function updateMappingQuickSwitch(
    file: string,
    quickSwitch: Omit<MappingQuickSwitch, "file">,
  ) {
    const previous = mappingQuickSwitches;
    const next = [
      ...mappingQuickSwitches.filter((config) => config.file !== file),
      { file, ...quickSwitch },
    ];
    setMappingQuickSwitches(next);
    try {
      await requestPost("/api/mapping/update_mapping_quick_switch", {
        file,
        ...quickSwitch,
      });
    } catch (error) {
      setMappingQuickSwitches(previous);
      messageApi?.error(error as string);
    }
  }

  async function updateMappingFile() {
    if (editState) {
      const errorMag = t("mappings.home.emptyBind");
      // Rebuild hidden macro scripts against the latest dragged mapping positions before validation/save.
      const curConfig = syncMacroScripts(editState.current);
      const validateDirectionBind = (bind: DirectionBinding) => {
        if (bind.type === "Button") {
          for (const b of [bind.up, bind.down, bind.left, bind.right]) {
            if (b.length === 0) {
              messageApi?.error(errorMag);
              return false;
            }
          }
        } else {
          if (bind.x === "" || bind.y === "") {
            messageApi?.error(errorMag);
            return false;
          }
        }
        return true;
      };
      for (const mapping of curConfig.mappings) {
        if (Array.isArray(mapping.bind)) {
          if (mapping.bind.length === 0) {
            messageApi?.error(errorMag);
            return;
          }
        } else {
          if (!validateDirectionBind(mapping.bind)) {
            return;
          }
        }

        if ("pad_bind" in mapping) {
          if (!validateDirectionBind(mapping.pad_bind)) {
            return;
          }
        }
      }

      dispatch(setIsLoading(true));
      try {
        const validateRes = await requestPost<MappingValidateResult>(
          "/api/mapping/validate",
          {
            file: editState.file,
            config: curConfig,
          },
        );
        if (!validateRes.data.valid) {
          setValidationDiagnostics(validateRes.data.diagnostics);
        } else {
          const res = await requestPost("/api/mapping/update_mapping", {
            file: editState.file,
            config: curConfig,
          });
          messageApi?.success(res.message);
          setValidationDiagnostics([]);
          setEditState({
            file: editState.file,
            edited: false,
            current: curConfig,
            old: deepClone(curConfig),
          });
        }
      } catch (error) {
        if (isValidationError(error)) {
          setValidationDiagnostics(error.data?.diagnostics ?? []);
        } else {
          messageApi?.error(error as string);
        }
      }
      dispatch(setIsLoading(false));
    }
  }

  async function restoreMappingFile() {
    if (editState) {
      setEditState({
        old: editState.old,
        current: deepClone(editState.old),
        edited: false,
        file: editState.file,
      });
    }
  }

  async function duplicateMappingFile(file: string, newFile: string) {
    dispatch(setIsLoading(true));
    try {
      const res = await requestPost("/api/mapping/duplicate_mapping", {
        file,
        new_file: newFile,
      });
      await loadMappingList(true);
      messageApi?.success(res.message);
    } catch (error) {
      messageApi?.error(error as string);
    }
    dispatch(setIsLoading(false));
  }

  async function deleteMappingFile(file: string) {
    dispatch(setIsLoading(true));
    try {
      const res = await requestPost("/api/mapping/delete_mapping", {
        file,
      });
      await loadMappingList(true);
      messageApi?.success(res.message);
    } catch (error) {
      messageApi?.error(error as string);
    }
    dispatch(setIsLoading(false));
  }

  async function createMappingFile(
    file: string,
    size: { width: number; height: number },
  ) {
    dispatch(setIsLoading(true));
    try {
      const res = await requestPost("/api/mapping/create_mapping", {
        file,
        config: {
          version: "0.0.1",
          original_size: size,
          mappings: [],
        },
      });
      await loadMappingList(true);
      messageApi?.success(res.message);
    } catch (error) {
      messageApi?.error(error as string);
    }
    dispatch(setIsLoading(false));
  }

  async function renameMappingFile(file: string, newFile: string) {
    dispatch(setIsLoading(true));
    try {
      const res = await requestPost("/api/mapping/rename_mapping", {
        file,
        new_file: newFile,
      });
      await loadMappingList(true);
      messageApi?.success(res.message);
    } catch (error) {
      messageApi?.error(error as string);
    }
    dispatch(setIsLoading(false));
  }

  async function migrateMappingFile(
    file: string,
    newFile: string,
    size: {
      width: number;
      height: number;
    },
  ) {
    dispatch(setIsLoading(true));
    try {
      const res = await requestPost("/api/mapping/migrate_mapping", {
        file,
        new_file: newFile,
        width: size.width,
        height: size.height,
      });
      await loadMappingList(true);
      messageApi?.success(res.message);
    } catch (error) {
      messageApi?.error(error as string);
    }
    dispatch(setIsLoading(false));
  }

  return (
    <>
      <MacroPresetModal
        open={isMacroManagerOpen}
        config={editState?.current ?? null}
        onClose={() => setIsMacroManagerOpen(false)}
        onConfigChange={(config) =>
          setEditState((prev) =>
            prev ? { ...prev, current: config, edited: true } : prev,
          )
        }
      />
      <Modal
        title="Mapping validation failed"
        open={validationDiagnostics.length > 0}
        onCancel={() => setValidationDiagnostics([])}
        footer={null}
        width={720}
      >
        <Flex vertical gap={8}>
          {validationDiagnostics.map((diagnostic, index) => (
            <div
              key={`${diagnostic.code}-${index}`}
              className="whitespace-pre-wrap rounded border border-solid border-red-500/40 px-3 py-2 font-mono text-sm"
            >
              {formatMappingDiagnostic(diagnostic)}
            </div>
          ))}
        </Flex>
      </Modal>
      <Flex
        vertical
        gap={32}
        id="mappings-container"
        data-mapping-drag-enabled={positionUnlocked ? "true" : "false"}
        className="page-container hide-scrollbar"
      >
      <Manager
        open={isManagerOpen}
        onCancel={() => setIsManagerOpen(false)}
        mappingList={mappingList}
        displayedMapping={displayedMappingFile}
        onActiveAction={changeActiveMapping}
        onDisplayAction={changeDisplayedMapping}
        onDuplicateAction={duplicateMappingFile}
        onDeleteAction={deleteMappingFile}
        onCreateAction={createMappingFile}
        onRenameAction={renameMappingFile}
        onMigrateAction={migrateMappingFile}
        quickSwitches={mappingQuickSwitches}
        onQuickSwitchChange={updateMappingQuickSwitch}
      />
      <section>
        <Flex justify="space-between" align="center">
          <Space.Compact>
            <Select
              className="w-80"
              showSearch
              value={displayedMappingFile}
              onChange={(value) => changeDisplayedMapping(value)}
              options={mappingListOptions}
            />
            <Button
              type="primary"
              disabled={editState === null || editState.edited === false}
              icon={<SaveOutlined />}
              onClick={updateMappingFile}
            >
              {t("mappings.home.save")}
            </Button>
            <Button
              type="primary"
              disabled={editState === null || editState.edited === false}
              icon={<RollbackOutlined />}
              onClick={restoreMappingFile}
            >
              {t("mappings.home.restore")}
            </Button>
            <Button
              disabled={activeMappingFile === displayedMappingFile}
              type="primary"
              icon={<CheckCircleOutlined />}
              onClick={() => changeActiveMapping(displayedMappingFile)}
            >
              {t("mappings.home.activate")}
            </Button>
            <Button
              type="primary"
              icon={<FileSyncOutlined />}
              onClick={() => loadMappingList()}
            >
              {t("mappings.home.refresh")}
            </Button>
            <Button
              type="primary"
              icon={<SettingOutlined />}
              onClick={() => setIsManagerOpen(true)}
            >
              {t("mappings.home.manage")}
            </Button>
          </Space.Compact>
          <Space>
            <Button
              type={positionUnlocked ? "primary" : "default"}
              icon={positionUnlocked ? <UnlockOutlined /> : <LockOutlined />}
              title={
                positionUnlocked
                  ? "当前位置已解锁：直接拖动键位即可调整，点击可重新锁定"
                  : "默认锁定位置：点击解锁后可直接拖动键位，不再需要删除重建"
              }
              onClick={() => setPositionUnlocked((value) => !value)}
            >
              {positionUnlocked ? "拖动调整" : "位置锁定"}
            </Button>
            <Button
              type={isMacroManagerOpen ? "primary" : "default"}
              icon={<ThunderboltOutlined />}
              disabled={!editState}
              onClick={() => setIsMacroManagerOpen(true)}
            >
              {t("mappings.home.macroPreset")}
            </Button>
            <Tooltip title={t("mappings.home.quickSwitchEnabled")}>
              <Switch
                checked={quickSwitchEnabled}
                onChange={(v) => updateGlobalToggle("quick_switch_enabled", v)}
                checkedChildren={t("mappings.home.quickSwitchOn")}
                unCheckedChildren={t("mappings.home.quickSwitchOff")}
              />
            </Tooltip>
            <Tooltip title={t("mappings.home.macroPresetEnabled")}>
              <Switch
                checked={macroPresetEnabled}
                onChange={(v) => updateGlobalToggle("macro_preset_enabled", v)}
                checkedChildren={t("mappings.home.macroPresetOn")}
                unCheckedChildren={t("mappings.home.macroPresetOff")}
              />
            </Tooltip>
            <Tooltip title={t("mappings.home.buttonRandomizationEnabled")}>
              <Switch
                checked={buttonRandomizationEnabled}
                onChange={(v) => updateGlobalToggle("button_randomization_enabled", v)}
                checkedChildren={t("mappings.home.buttonRandomizationOn")}
                unCheckedChildren={t("mappings.home.buttonRandomizationOff")}
              />
            </Tooltip>
            <Tooltip title={t("mappings.home.randomizationEnabled")}>
              <Switch
                checked={randomizationEnabled}
                onChange={(v) => updateGlobalToggle("mapping_randomization_enabled", v)}
                checkedChildren={t("mappings.home.randomizationOn")}
                unCheckedChildren={t("mappings.home.randomizationOff")}
              />
            </Tooltip>
            <Button
              icon={<KeyOutlined />}
              onClick={() => setIsBoundSettingsOpen(true)}
            >
              {t("mappings.home.boundSettings")}
            </Button>
            <Button
              type={showAllMappingGuides ? "primary" : "default"}
              icon={<EyeOutlined />}
              onClick={() => setShowAllMappingGuides((value) => !value)}
            >
              {t("mappings.home.showGuides")}
            </Button>
            <Button
              type={showRandomRanges ? "primary" : "default"}
              icon={<EyeOutlined />}
              onClick={() => setShowRandomRanges((value) => !value)}
            >
              {t("mappings.home.showRandomRanges")}
            </Button>
            <RefreshImageButton />
          </Space>
        </Flex>
      </section>
      <section className="flex-grow-1 flex-shrink-0 pb-4">
        {editState && (
          <Splitter className="w-full h-full">
            <Splitter.Panel
              className="flex justify-center items-center"
              defaultSize="95%"
              min="5%"
              max="99%"
            >
              <Displayer
                state={editState}
                setState={setEditState}
                showAllMappingGuides={showAllMappingGuides}
                showRandomRanges={showRandomRanges}
              />
            </Splitter.Panel>
            <Splitter.Panel
              style={{ overflowY: "auto" }}
              min="180px"
              defaultSize="260px"
            >
              <KeyBindingList
                mappings={editState.current.mappings}
                onSelect={(id) => highlightMappingButton(id)}
              />
            </Splitter.Panel>
          </Splitter>
        )}
      </section>
      </Flex>
      <Modal
        open={isBoundSettingsOpen}
        onCancel={() => setIsBoundSettingsOpen(false)}
        footer={null}
        title={t("mappings.home.boundSettingsTitle")}
      >
        <div className="mb-2">
          <Typography.Text type="secondary">
            {t("mappings.home.boundSettingsHint")}
          </Typography.Text>
        </div>
        <Flex justify="space-between" align="center">
          <Typography.Title level={5} style={{ marginBottom: 0 }}>
            {t("mappings.home.boundPresetSwitch")}
          </Typography.Title>
          <Button
            size="small"
            icon={<SettingOutlined />}
            onClick={() => {
              setIsBoundSettingsOpen(false);
              setIsManagerOpen(true);
            }}
          >
            {t("mappings.home.configureNow")}
          </Button>
        </Flex>
        {mappingQuickSwitches.filter((qs) => qs.shortcut.length > 0).length === 0 ? (
          <Typography.Text type="secondary">
            {t("mappings.home.noBoundKeys")}
          </Typography.Text>
        ) : (
          <ul className="list-none m-0 p-0">
            {mappingQuickSwitches
              .filter((qs) => qs.shortcut.length > 0)
              .map((qs) => (
                <li key={qs.file} className="mb-1">
                  <Tag color="blue">{qs.shortcut.join("+")}</Tag>
                  <Typography.Text>{qs.file}</Typography.Text>
                </li>
              ))}
          </ul>
        )}
        <Flex justify="space-between" align="center" style={{ marginTop: 12 }}>
          <Typography.Title level={5} style={{ marginBottom: 0 }}>
            {t("mappings.home.boundMacroPreset")}
          </Typography.Title>
          <Button
            size="small"
            icon={<SettingOutlined />}
            onClick={() => {
              setIsBoundSettingsOpen(false);
              setIsMacroManagerOpen(true);
            }}
          >
            {t("mappings.home.configureNow")}
          </Button>
        </Flex>
        {(() => {
          const macros = (editState?.current.mappings ?? []).filter(isMacroScript);
          if (macros.length === 0) {
            return (
              <Typography.Text type="secondary">
                {t("mappings.home.noBoundKeys")}
              </Typography.Text>
            );
          }
          return (
            <ul className="list-none m-0 p-0">
              {macros.map((m) => (
                <li key={m.id} className="mb-1">
                  <Tag color="green">{m.bind.length > 0 ? m.bind.join("+") : t("mappings.home.unbound")}</Tag>
                  <Typography.Text ellipsis>{m.note}</Typography.Text>
                </li>
              ))}
            </ul>
          );
        })()}
      </Modal>
    </>
  );
}
