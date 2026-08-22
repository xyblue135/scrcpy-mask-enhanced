/**
 * 全局被占用的按键集合。
 *
 * 预设切换（quick switch）快捷键和宏预设（macro preset）绑定的按键
 * 会注册到这里，下方的按键映射配置在录入按键时会被阻止使用这些键。
 */
let reservedKeys = new Set<string>();

/** 注册一组被占用的按键（整体替换）。 */
export function setReservedKeys(keys: Iterable<string>) {
  reservedKeys = new Set(keys);
}

/** 查询某个按键是否已被占用。 */
export function isKeyReserved(key: string): boolean {
  return reservedKeys.has(key);
}

/** 获取所有被占用的按键。 */
export function getReservedKeys(): Set<string> {
  return reservedKeys;
}
