/**
 * One-off branding migration: replaces the old monogram mark with the supplied
 * HATI PLC emblem, inserts the theme toggle into every portal header, and drops
 * the leftover demo-access label from the navigation.
 *
 * Usage: node scripts/apply-branding.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const write = (p, s) => writeFileSync(join(root, p), s);

const layouts = [
  "src/components/sales/SalesLayout.tsx",
  "src/components/finance/FinanceLayout.tsx",
  "src/components/admin/AdminLayout.tsx",
  "src/components/hr/HrLayout.tsx",
];

for (const file of layouts) {
  let source = read(file);

  // 1. Drop the old letter-monogram component.
  source = source.replace(
    /function NexMark\(\{ className = "size-8" \}: \{ className\?: string \}\) \{[\s\S]*?\n\}\n\n/,
    "",
  );
  source = source.replace(/<NexMark \/>/g, '<BrandLogo size={32} className="rounded-full" />');

  // 2. Import the real brand mark + theme toggle.
  if (!source.includes('from "@/components/BrandLogo"')) {
    source = source.replace(
      /^import /m,
      'import { BrandLogo } from "@/components/BrandLogo";\nimport { ThemeToggle } from "@/components/ThemeToggle";\nimport ',
    );
  }

  // 3. Theme toggle in the portal header, before the notification bell.
  if (!source.includes("<ThemeToggle />")) {
    source = source.replace(
      /(<div className="flex items-center gap-3">\n\s*)<button className="relative rounded-lg p-1\.5/,
      '$1<ThemeToggle />\n            <button className="relative rounded-lg p-1.5',
    );
  }

  // 4. Remove the development-only "Demo Access" label.
  source = source.replace(/\{session\?\.isGuest \? "Demo Access" : "([^"]+)"\}/g, '"$1"');
  source = source.replace(
    /const \{ user, session, signOut \} = useAuth\(\);/,
    "const { user, signOut } = useAuth();",
  );

  // 5. Sidebar separators use the sidebar border token.
  source = source.replace(/<Separator className="bg-sidebar" \/>/g, '<Separator className="bg-sidebar-border" />');

  write(file, source);
  console.log(`updated ${file}`);
}

// Landing page (kept as the public marketing view) uses the same mark.
let landing = read("src/pages/Landing.tsx");
landing = landing.replace(
  /function NexMark\(\{ className = "size-8" \}: \{ className\?: string \}\) \{[\s\S]*?\n\}\n\n/,
  "",
);
landing = landing.replace(/<NexMark \/>/g, '<BrandLogo size={40} />');
if (!landing.includes('from "@/components/BrandLogo"')) {
  landing = landing.replace(
    /^import /m,
    'import { BrandLogo } from "@/components/BrandLogo";\nimport { ThemeToggle } from "@/components/ThemeToggle";\nimport ',
  );
}
if (!landing.includes("<ThemeToggle")) {
  landing = landing.replace(
    /(\n\s*)(<button\n\s*onClick=\{\(\) => navigate\("\/auth\?returnTo=\/sales"\)\})/,
    '$1<ThemeToggle scope="landing" />$1$2',
  );
}
write("src/pages/Landing.tsx", landing);
console.log("updated src/pages/Landing.tsx");

// Sign-in page: real brand mark instead of the bare "ERP" text.
let auth = read("src/pages/Auth.tsx");
auth = auth.replace(
  /<header className="flex items-center justify-between px-6 py-5">([\s\S]*?)<\/header>/,
  `<header className="flex items-center justify-between px-6 py-5">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="flex items-center gap-3 text-left"
        >
          <BrandLogo size={40} />

          <div>
            <div className="font-heading text-base font-semibold leading-none tracking-tight text-foreground">
              HATI PLC
            </div>

            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
              Enterprise Resource Planning
            </div>
          </div>
        </button>

        <ThemeToggle />
      </header>`,
);
if (!auth.includes('from "@/components/BrandLogo"')) {
  auth = auth.replace(
    /^import /m,
    'import { BrandLogo } from "@/components/BrandLogo";\nimport { ThemeToggle } from "@/components/ThemeToggle";\nimport ',
  );
}
write("src/pages/Auth.tsx", auth);
console.log("updated src/pages/Auth.tsx");
