export function BrandLogo({ className = "h-8", testid = "brand-logo-img" }) {
  return <img src="/brand/housebets-logo.png" alt="Housebets" data-testid={testid} className={`${className} w-auto shrink-0 select-none`} draggable={false} />;
}
