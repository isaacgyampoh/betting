export function Prose({ children }: { children: React.ReactNode }) {
  return (
    <article className="max-w-prose space-y-4 text-sm leading-relaxed text-muted-foreground [&_a]:text-primary [&_a]:underline [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:tracking-tight [&_h1]:text-foreground [&_h2]:pt-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-foreground">
      {children}
    </article>
  );
}
