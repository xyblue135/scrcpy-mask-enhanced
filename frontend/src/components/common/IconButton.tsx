import { Tooltip } from "antd";
import type { MouseEvent } from "react";

type IconButtonProps = {
  icon: React.ReactNode;
  size?: number;
  color?: "default" | "info" | "error" | "primary" | "success" | "warning";
  tooltip?: string;
  /**
   * <a> 原生不支持 disabled，但很多场景（例如子预设不可重命名/迁移）需要
   * 视觉上禁用 + 阻止点击。命中时同时阻止默认行为、阻止冒泡，
   * 让包裹它的 Popconfirm 等组件不会触发。
   */
  disabled?: boolean;
} & Omit<React.ComponentProps<"a">, "disabled">;

export default function IconButton({
  icon,
  size,
  color,
  tooltip,
  disabled,
  onClick,
  ...rest
}: IconButtonProps) {
  color = color ?? "default";
  size = size ?? 16;

  const className =
    (color === "default"
      ? "color-text hover:color-text-hover active:color-text-active"
      : `color-${color}-text hover:color-${color}-text-hover active:color-${color}-text-active`) +
    " block active:transform-scale-95 transition-duration-300 ease-in-out" +
    (disabled ? " opacity-40 pointer-events-none cursor-not-allowed" : "");

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (disabled) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onClick?.(e);
  };

  const anchor = (
    <a
      style={{ fontSize: size }}
      className={className}
      onClick={handleClick}
      aria-disabled={disabled || undefined}
      {...rest}
    >
      {icon}
    </a>
  );

  if (tooltip !== undefined) {
    return <Tooltip title={tooltip}>{anchor}</Tooltip>;
  }

  return anchor;
}
