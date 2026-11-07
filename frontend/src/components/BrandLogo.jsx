export function BrandLogo({ className = "h-8", testid = "brand-logo-img" }) {
  return <img src="/brand/housebets-logo.png" alt="Housebets" data-testid={testid} className={`${className} w-auto select-none`} draggable={false} />;
}
