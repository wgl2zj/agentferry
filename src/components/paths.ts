// 前端展示用路径拼接：不手拼反斜杠，统一用正斜杠（Windows 同样识别）。

/** 目录 + 文件名 → 完整路径；目录为空时只返回文件名（避免写到盘根）。 */
export function joinPath(dir: string, file: string): string {
  const trimmed = dir.trim();
  if (!trimmed) return file;
  return `${trimmed.replace(/[\\/]+$/, "")}/${file}`;
}
