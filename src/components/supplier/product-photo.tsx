// A product's photo (its VRPRIME master SKU's), small, next to its name. Tap it to see it full size. Nothing when the
// product has no photo yet.
export function ProductPhoto({ src, name, size = 48 }: { src?: string | null; name: string; size?: number }) {
  if (!src) return null;
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      title={`${name}: open the photo`}
      className="focus-ring block shrink-0 overflow-hidden rounded-[10px] border border-line-soft bg-white"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- served by the portal at a fixed address, kept by the browser */}
      <img src={src} alt={`Photo of ${name}`} width={size} height={size} loading="lazy" decoding="async" className="h-full w-full object-contain" />
    </a>
  );
}

/** A product's name with its photo before it. */
export function WithPhoto({ src, name, size = 44, children }: { src?: string | null; name: string; size?: number; children?: React.ReactNode }) {
  if (!src) return <>{children ?? name}</>;
  return (
    <span className="flex items-center gap-2.5">
      <ProductPhoto src={src} name={name} size={size} />
      <span className="min-w-0">{children ?? name}</span>
    </span>
  );
}
