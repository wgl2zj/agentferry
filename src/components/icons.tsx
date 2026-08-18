// 内联 SVG 图标库：全站唯一图标来源，均为纯装饰图标（aria-hidden）。
// 需要可访问名称的场景由按钮文字或 aria-label 承担。
interface IconProps {
  size?: number;
}

function base(props: IconProps) {
  const size = props.size ?? 16;
  return {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    "aria-hidden": true as const,
    focusable: false as const,
  };
}

const stroke = {
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IconHome(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path {...stroke} d="M2.5 6.5 8 2l5.5 4.5V13a1 1 0 0 1-1 1h-3v-4h-3v4h-3a1 1 0 0 1-1-1Z" />
    </svg>
  );
}

export function IconPack(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path {...stroke} d="M2 5.5 8 2l6 3.5v5L8 14l-6-3.5Z" />
      <path {...stroke} d="M2 5.5 8 9l6-3.5M8 9v5" />
    </svg>
  );
}

export function IconUnpack(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path {...stroke} d="M2 5.5 8 2l6 3.5v5L8 14l-6-3.5Z" />
      <path {...stroke} d="M8 6v4M6 8l2 2 2-2" />
    </svg>
  );
}

export function IconSettings(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle {...stroke} cx="8" cy="8" r="2.2" />
      <path
        {...stroke}
        d="M8 1.8v1.7M8 12.5v1.7M2.6 4.9l1.5.9M11.9 10.2l1.5.9M2.6 11.1l1.5-.9M11.9 5.8l1.5-.9"
      />
    </svg>
  );
}

export function IconCheck(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path {...stroke} d="m3 8.5 3.2 3L13 4.5" />
    </svg>
  );
}

export function IconWarning(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path {...stroke} d="M8 2 1.8 13.5h12.4Z" />
      <path {...stroke} d="M8 6.2v3.2M8 11.6v.1" />
    </svg>
  );
}

export function IconError(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle {...stroke} cx="8" cy="8" r="6" />
      <path {...stroke} d="m5.8 5.8 4.4 4.4M10.2 5.8l-4.4 4.4" />
    </svg>
  );
}

export function IconInfo(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle {...stroke} cx="8" cy="8" r="6" />
      <path {...stroke} d="M8 7.2v3.4M8 4.3v.1" />
    </svg>
  );
}

export function IconFolder(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path {...stroke} d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.7H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z" />
    </svg>
  );
}

export function IconFile(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path {...stroke} d="M4 1.8h5l3 3v9.4H4Z" />
      <path {...stroke} d="M9 1.8v3h3" />
    </svg>
  );
}

export function IconClose(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path {...stroke} d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}

export function IconSkip(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle {...stroke} cx="8" cy="8" r="6" />
      <path {...stroke} d="m4.5 4.5 7 7" />
    </svg>
  );
}
