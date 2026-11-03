const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Applies the chosen brand colours across the app. Values are checked as plain
 * colour codes first, because they're written straight into a style tag.
 */
export function BrandStyle({ primary, accent }: { primary: string; accent: string }) {
  if (!HEX.test(primary) || !HEX.test(accent)) return null;
  const css = `
:root {
  --primary: ${primary};
  --sidebar-primary: ${primary};
  --ring: ${primary};
  --sidebar-ring: ${primary};
  --chart-1: ${primary};
  --primary-soft: color-mix(in oklch, ${primary} 8%, white);
  --primary-soft-foreground: color-mix(in oklch, ${primary} 88%, black);
  --brand-accent: ${accent};
}
.dark {
  --primary: ${primary};
  --sidebar-primary: ${primary};
  --ring: color-mix(in oklch, ${primary} 70%, white);
  --sidebar-ring: color-mix(in oklch, ${primary} 70%, white);
  --chart-1: color-mix(in oklch, ${primary} 70%, white);
  --primary-soft: color-mix(in oklch, ${primary} 20%, transparent);
  --primary-soft-foreground: color-mix(in oklch, ${primary} 45%, white);
  --brand-accent: ${accent};
}`;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
